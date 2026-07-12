#!/usr/bin/env bun
/**
 * End-to-end shielded borrow via the CLI. Bypasses the browser UI so
 * we can isolate contract-side behaviour when the client stack acts
 * up. Assumes the deployer identity already holds ≥ 4 XLM shielded
 * notes on the configured contract — if not, prepend deposits via
 * `contracts/scripts/e2e-deposit.ts` (mirrors this file's shape).
 *
 * Usage:
 *   bun contracts/scripts/e2e-borrow.ts
 *
 * Reads:
 *   .env.local — NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID, RPC URL,
 *                Reflector CEX contract id, network passphrase.
 *   stellar    — `stellar keys address deployer`, `stellar keys secret deployer`.
 */

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

// Load .env.local manually — Bun has native support but we do this by
// hand to keep the script dependency-free.
loadEnvLocal(".env.local")

function loadEnvLocal(path: string): void {
  try {
    const raw = readFileSync(path, "utf8")
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1")
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // fall through — env may already be exported
  }
}

const CONTRACT_ID = required("NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID")
const RPC_URL = required("NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL")
const REFLECTOR_CEX = required("NEXT_PUBLIC_STELLAR_REFLECTOR_CEX_CONTRACT_ID")
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
const BORROW_ASSET = "USDC"
const COLLATERAL_ASSET = "XLM"

const stellarAddr = stellarCli(["keys", "address", "deployer"])
const stellarSecret = stellarCli(["keys", "secret", "deployer"])
if (!stellarAddr || !stellarSecret) {
  throw new Error("stellar keys deployer not found; run `stellar keys generate deployer` first")
}
console.log("Using deployer:", stellarAddr)

// ---- Late imports (avoid load-time env crashes) ---------------------
const { poseidon } = await import("../../features/notes/poseidon")
const { computeCommitment, computeNullifier, assetTag, DENOMINATION } =
  await import("../../features/notes/note")
const { verifyInclusion, zeroHashes, DEPTH } = await import(
  "../../features/notes/merkle"
)
const memo = await import("../../features/notes/memo")
const { proveBorrow } = await import(
  "../../features/shielded-pool/borrow-prover"
)
const stellarSdk: typeof import("@stellar/stellar-sdk") = await import(
  "@stellar/stellar-sdk"
)
const bindingsModule = await import(
  "../../features/protocol/bindings/borrow-pool"
)
const {
  Keypair,
  Networks,
  rpc: { Server: RpcServer },
  xdr,
  scValToNative,
} = stellarSdk
void Networks

// ---- Derive shielded identity from deployer address ------------------
const identity = await deriveIdentity(stellarAddr)
console.log("Shielded identity pubkey:", toHex(identity.publicKey).slice(0, 16), "…")

// ---- Field arithmetic + randomness ----------------------------------
const FR_ORDER =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n
function rand(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v % FR_ORDER
}

// ---- Fetch all deposit events for the collateral asset ---------------
const server = new RpcServer(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") })
const latest = await server.getLatestLedger()
const startLedger = Math.max(1, latest.sequence - 10_000)
const depositTopic = xdr.ScVal.scvSymbol("deposit").toXDR("base64")
const assetSymbol = xdr.ScVal.scvSymbol(COLLATERAL_ASSET).toXDR("base64")
const rawResp = await server.getEvents({
  filters: [
    {
      type: "contract",
      contractIds: [CONTRACT_ID],
      topics: [[depositTopic, assetSymbol]],
    },
  ],
  startLedger,
  limit: 500,
})
const events = (rawResp as { events?: unknown[] }).events ?? []
console.log(`Deposit events: ${events.length}`)

// ---- Decode + decrypt memos to recover our notes ---------------------
type Note = {
  amount: bigint
  asset: string
  index: number
  salt: bigint
  sk: bigint
  leaf: bigint
}
const notes: Note[] = []
const chainLeaves: { index: number; leaf: bigint }[] = []
for (const event of events as {
  topic?: unknown[]
  topics?: unknown[]
  value?: unknown
}[]) {
  const scVal = toScVal(event.value)
  if (!scVal) continue
  const native = scValToNative(scVal) as unknown[]
  if (!Array.isArray(native) || native.length !== 4) continue
  const index = Number(native[0])
  const leaf = bytesToBigInt(native[2])
  const memoBytes = new Uint8Array(native[3] as ArrayBuffer)
  chainLeaves.push({ index, leaf })
  const opened = memo.tryDecryptAnyMemo({
    raw: memoBytes,
    recipientSk: identity.secretKey,
  })
  if (!opened || opened.tree !== "deposit") continue
  const salt = BigInt(opened.salt)
  const noteAsset = opened.asset
  if (noteAsset !== COLLATERAL_ASSET) continue
  const note: Note = {
    amount: DENOMINATION[COLLATERAL_ASSET],
    asset: COLLATERAL_ASSET,
    index,
    salt,
    sk: identity.skField,
    leaf,
  }
  notes.push(note)
}
notes.sort((a, b) => a.index - b.index)
chainLeaves.sort((a, b) => a.index - b.index)
console.log(`Decrypted own notes: ${notes.length}`)
for (const n of notes) {
  console.log(
    "  note",
    n.index,
    "leaf(chain):",
    chainLeaves.find((c) => c.index === n.index)?.leaf.toString().slice(0, 16),
    "…",
    "leaf(computed):",
    computeCommitment({
      amount: n.amount,
      asset: n.asset as "XLM",
      salt: n.salt,
      sk: n.sk,
    })
      .toString()
      .slice(0, 16),
    "…"
  )
}

if (notes.length < 4) {
  console.log(
    `Not enough own notes on chain (${notes.length}/4). Depositing to fill the gap…`
  )
  const { proveDeposit } = await import(
    "../../features/shielded-pool/deposit-prover"
  )
  const depositWasmUrl = `file://${new URL("../../public/circuits-circom/shielded/deposit/deposit.wasm", import.meta.url).pathname}`
  const depositZkeyUrl = `file://${new URL("../../public/circuits-circom/shielded/deposit/deposit.zkey", import.meta.url).pathname}`

  const depositClient = new bindingsModule.Client({
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: stellarAddr,
  })
  for (let i = 0; notes.length < 4 && i < 8; i++) {
    const salt = rand()
    const depositProof = await proveDeposit(
      {
        amount: DENOMINATION[COLLATERAL_ASSET],
        asset: COLLATERAL_ASSET,
        salt,
        sk: identity.skField,
      },
      { wasmUrl: depositWasmUrl, zkeyUrl: depositZkeyUrl }
    )
    const depositMemo = memo.encodeMemoBundle(
      memo.encryptMemo({
        plaintext: {
          amount: DENOMINATION[COLLATERAL_ASSET].toString(),
          asset: COLLATERAL_ASSET,
          index: 0,
          salt: salt.toString(),
          tree: "deposit",
        },
        recipientPk: identity.publicKey,
      })
    )
    const asm = await depositClient.deposit_shielded({
      from: stellarAddr,
      asset: COLLATERAL_ASSET,
      proof: {
        a: Buffer.from(depositProof.a),
        b: Buffer.from(depositProof.b),
        c: Buffer.from(depositProof.c),
        oracle_epoch: BigInt(0),
        public_signals: depositProof.publicSignals.map(bytesUintToBigint),
      },
      memo: Buffer.from(depositMemo),
    })
    const dsent = await asm.signAndSend({
      signTransaction: (async (xdrToSign: string) => {
        const tx = new stellarSdk.Transaction(xdrToSign, NETWORK_PASSPHRASE)
        tx.sign(Keypair.fromSecret(stellarSecret))
        return { signedTxXdr: tx.toXDR(), signerAddress: stellarAddr }
      }) as unknown as never,
    })
    const dhash = dsent.sendTransactionResponse?.hash
    // SDK Result Ok<u64>.value carries the leaf index.
    const dresult = dsent.result as unknown as
      | { value: bigint }
      | { error: { message: string } }
    if (dresult && "error" in dresult) throw new Error(dresult.error.message)
    const leafIndex = Number(("value" in dresult ? dresult.value : 0n) as bigint)
    console.log(`  deposit #${notes.length} → leaf ${leafIndex} (${dhash})`)
    const leaf = computeCommitment({
      amount: DENOMINATION[COLLATERAL_ASSET],
      asset: COLLATERAL_ASSET,
      salt,
      sk: identity.skField,
    })
    chainLeaves.push({ index: leafIndex, leaf })
    notes.push({
      amount: DENOMINATION[COLLATERAL_ASSET],
      asset: COLLATERAL_ASSET,
      index: leafIndex,
      salt,
      sk: identity.skField,
      leaf,
    })
    // Wait a bit for RPC to index before the next round.
    await new Promise((r) => setTimeout(r, 3000))
  }
  chainLeaves.sort((a, b) => a.index - b.index)
  notes.sort((a, b) => a.index - b.index)
  if (notes.length < 4) {
    throw new Error(`Only reached ${notes.length}/4 deposits after retries`)
  }
}

// ---- Build tree witnesses (final-state, single root) -----------------
const collateralNotes = notes.slice(0, 4)
const witnesses = buildWitnesses(chainLeaves.map((l) => l.leaf))
const collateralWitnesses = collateralNotes.map((n) => {
  const w = witnesses.find((x) => x.leafIndex === n.index)
  if (!w) throw new Error(`No witness at leaf index ${n.index}`)
  return w
})
const commonRoot = collateralWitnesses[0].root
console.log(`Common tree root: ${commonRoot.toString().slice(0, 16)}…`)
for (const w of collateralWitnesses) {
  if (w.root !== commonRoot) {
    throw new Error(`Witness root mismatch at leaf ${w.leafIndex}`)
  }
}

// ---- Oracle price (best-effort) -------------------------------------
let oraclePrice = 1n
try {
  const priceRes = await fetchReflectorPrice(server, REFLECTOR_CEX, COLLATERAL_ASSET)
  if (priceRes && priceRes > 0n) oraclePrice = priceRes
} catch (err) {
  console.warn("Reflector price fetch failed, using 1:", (err as Error).message)
}
console.log(`Oracle price used: ${oraclePrice.toString()}`)

// ---- Risk params (hardcoded to match deploy runbook) ----------------
const HF_MIN_BPS = 12500
const MAX_LTV_BPS = 6250

// ---- Salts for borrow proof ------------------------------------------
const borrowSalt = rand()
const bondSaltAmount = rand()
const bondSaltValue = rand()
const bondSaltPrice = rand()

// ---- Generate borrow proof ------------------------------------------
console.log("Generating borrow proof…")
const proof = await proveBorrow(
  {
    borrowAsset: BORROW_ASSET,
    borrowSalt,
    collateralAsset: COLLATERAL_ASSET,
    collateralNotes: collateralNotes.map((n) => ({
      amount: n.amount,
      asset: n.asset as "XLM",
      index: n.index,
      salt: n.salt,
      sk: n.sk,
      tree: "deposit",
    })),
    collateralPaths: collateralWitnesses.map((w) => w.pathElements),
    collateralBits: collateralWitnesses.map((w) => w.pathBits),
    depositRoot: commonRoot,
    hfMinBps: HF_MIN_BPS,
    maxLtvBps: MAX_LTV_BPS,
    oraclePrice,
    sk: identity.skField,
    bondSaltAmount,
    bondSaltValue,
    bondSaltPrice,
  },
  {
    wasmUrl: `file://${new URL("../../public/circuits-circom/shielded/borrow/borrow.wasm", import.meta.url).pathname}`,
    zkeyUrl: `file://${new URL("../../public/circuits-circom/shielded/borrow/borrow.zkey", import.meta.url).pathname}`,
  }
)
console.log(`Borrow proof done: borrowAmount=${proof.borrowAmount.toString()}`)

// ---- Encode memo -----------------------------------------------------
const totalCollateral = collateralNotes.reduce((acc, n) => acc + n.amount, 0n)
const memoPlaintext = {
  amount: proof.borrowAmount.toString(),
  asset: BORROW_ASSET,
  index: 0,
  salt: borrowSalt.toString(),
  tree: "loan" as const,
  bond: {
    saltAmount: bondSaltAmount.toString(),
    saltValue: bondSaltValue.toString(),
    saltPrice: bondSaltPrice.toString(),
    collateralValue: (totalCollateral * oraclePrice).toString(),
    oraclePrice: oraclePrice.toString(),
    collateralAsset: COLLATERAL_ASSET,
  },
}
const encMemo = memo.encodeMemoBundle(
  memo.encryptMemo({ plaintext: memoPlaintext, recipientPk: identity.publicKey })
)

// ---- Submit borrow_shielded via bindings client ----------------------
console.log("Submitting borrow_shielded…")
const client = new bindingsModule.Client({
  contractId: CONTRACT_ID,
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  publicKey: stellarAddr,
})
const assembled = await client.borrow_shielded({
  from: stellarAddr,
  collateral_asset: COLLATERAL_ASSET,
  borrow_asset: BORROW_ASSET,
  proof: {
    a: Buffer.from(proof.a),
    b: Buffer.from(proof.b),
    c: Buffer.from(proof.c),
    oracle_epoch: BigInt(0),
    public_signals: proof.publicSignals.map(bytesUintToBigint),
  },
  memo: Buffer.from(encMemo),
})
const keypair = Keypair.fromSecret(stellarSecret)
const sent = await assembled.signAndSend({
  signTransaction: (async (xdrToSign: string) => {
    const tx = new stellarSdk.Transaction(xdrToSign, NETWORK_PASSPHRASE)
    tx.sign(keypair)
    return { signedTxXdr: tx.toXDR(), signerAddress: stellarAddr }
  }) as unknown as never,
})
const txHash = sent.sendTransactionResponse?.hash
console.log(`Submitted: ${txHash}`)
console.log(`https://stellar.expert/explorer/testnet/tx/${txHash}`)

// ==== Helpers =========================================================
function required(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`env ${name} missing`)
  return v
}

function stellarCli(args: string[]): string | null {
  const r = spawnSync("stellar", args, { encoding: "utf8" })
  if (r.status !== 0) return null
  return r.stdout.trim() || null
}

async function deriveIdentity(address: string) {
  const encoded = new TextEncoder().encode(`stellar-shield:${address}`)
  const buffer = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(buffer).set(encoded)
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))
  const { publicKey, secretKey } = memo.deriveShieldedIdentity(seed)
  let skField = 0n
  for (const b of secretKey) skField = (skField << 8n) | BigInt(b)
  return { publicKey, secretKey, skField }
}

function bytesToBigInt(raw: unknown): bigint {
  if (raw instanceof Uint8Array) {
    let v = 0n
    for (const b of raw) v = (v << 8n) | BigInt(b)
    return v
  }
  if (raw instanceof ArrayBuffer) {
    return bytesToBigInt(new Uint8Array(raw))
  }
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [k: number]: number }
    const bytes = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) bytes[i] = arr[i]
    return bytesToBigInt(bytes)
  }
  throw new Error("bytesToBigInt: unsupported input")
}

function bytesUintToBigint(bytes: Uint8Array): bigint {
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function toScVal(value: unknown) {
  if (typeof value === "string") {
    try {
      return xdr.ScVal.fromXDR(value, "base64")
    } catch {
      return null
    }
  }
  if (value && typeof value === "object" && "toXDR" in value) {
    return value as InstanceType<typeof xdr.ScVal>
  }
  return null
}

type BuiltWitness = {
  leaf: bigint
  leafIndex: number
  pathBits: number[]
  pathElements: bigint[]
  root: bigint
}

function buildWitnesses(leaves: bigint[]): BuiltWitness[] {
  const zeros = zeroHashes()
  const levels: bigint[][] = []
  levels[0] = leaves.slice()
  for (let level = 0; level < DEPTH; level++) {
    const cur = levels[level]
    const next: bigint[] = []
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i]
      const right = i + 1 < cur.length ? cur[i + 1] : zeros[level]
      next.push(poseidon([left, right]))
    }
    levels[level + 1] = next
  }
  const root = levels[DEPTH].length > 0 ? levels[DEPTH][0] : zeros[DEPTH]
  const out: BuiltWitness[] = []
  for (let index = 0; index < leaves.length; index++) {
    const path: bigint[] = []
    const bits: number[] = []
    for (let level = 0; level < DEPTH; level++) {
      const pos = index >> level
      const siblingPos = pos ^ 1
      const arr = levels[level]
      path.push(siblingPos < arr.length ? arr[siblingPos] : zeros[level])
      bits.push(pos & 1)
    }
    if (
      !verifyInclusion({ leaf: leaves[index], leafIndex: index, path, root })
    )
      continue
    out.push({
      leaf: leaves[index],
      leafIndex: index,
      pathBits: bits,
      pathElements: path,
      root,
    })
  }
  return out
}

async function fetchReflectorPrice(
  srv: InstanceType<typeof RpcServer>,
  contractId: string,
  asset: string
): Promise<bigint | null> {
  const feed = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    xdr.ScVal.scvSymbol(asset),
  ])
  const call = new stellarSdk.Contract(contractId).call("lastprice", feed)
  const src =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP66"
  const tx = new stellarSdk.TransactionBuilder(
    new stellarSdk.Account(src, "0"),
    {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    }
  )
    .addOperation(call)
    .setTimeout(30)
    .build()
  const sim = (await srv.simulateTransaction(tx)) as {
    result?: { retval: unknown }
  }
  if (!sim.result?.retval) return null
  const native = scValToNative(sim.result.retval as InstanceType<typeof xdr.ScVal>) as {
    price?: bigint
  }
  return native?.price ?? null
}

// silence unused-import warnings
void assetTag
void computeCommitment
void computeNullifier
void readFileSync
void memoPlaintext
