#!/usr/bin/env bun
/**
 * Seed the pool's reserve for one asset so a demo (or any real test
 * traffic) doesn't hit BR10 (docs/BRD.md) — `borrow_shielded` mints a
 * loan note with no check that the pool can pay it out, so a thin
 * reserve means a borrower's Claim can fail after they've already
 * burned ~10-30s proving. This script only deposits; it never
 * borrows, so it has no side effects beyond raising `total_deposit`.
 *
 * Idempotent to target: reads the live `total_deposit(asset)` note
 * count first and only submits as many `deposit_shielded_quad` calls
 * as needed to reach it. Safe to re-run after a demo session has
 * drawn the reserve back down.
 *
 * Usage:
 *   bun contracts/scripts/seed-liquidity.ts [asset] [targetNotes]
 *   bun contracts/scripts/seed-liquidity.ts XLM 24
 *
 * Defaults: asset=XLM, targetNotes=24 (buffer above the ~20-note
 * floor for "10-20 demo users x up to 1 note borrowed each").
 *
 * Reads:
 *   .env.local — NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID, RPC URL,
 *                network passphrase.
 *   stellar    — `stellar keys address deployer`, `stellar keys secret deployer`.
 */

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

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
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

const SEED_ASSET = (process.argv[2] || "XLM") as "XLM" | "USDC" | "EURC"
const TARGET_NOTES = Number(process.argv[3] || 24)
if (!Number.isFinite(TARGET_NOTES) || TARGET_NOTES <= 0) {
  throw new Error(`invalid targetNotes: ${process.argv[3]}`)
}

const stellarAddr =
  process.env.DEPLOYER_ADDRESS?.trim() || stellarCli(["keys", "address", "deployer"])
const stellarSecret =
  process.env.DEPLOYER_SECRET?.trim() || stellarCli(["keys", "secret", "deployer"])
if (!stellarAddr || !stellarSecret) {
  throw new Error(
    "deployer key not found; set DEPLOYER_ADDRESS + DEPLOYER_SECRET, or run `stellar keys generate deployer`"
  )
}
console.log("Using deployer:", stellarAddr)

const { DENOMINATION } = await import("../../features/notes/note")
const memo = await import("../../features/notes/memo")
const stellarSdk: typeof import("@stellar/stellar-sdk") = await import(
  "@stellar/stellar-sdk"
)
const bindingsModule = await import(
  "../../features/protocol/bindings/borrow-pool"
)
const { Keypair } = stellarSdk

const identity = await deriveIdentity(stellarAddr)

const client = new bindingsModule.Client({
  contractId: CONTRACT_ID,
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  publicKey: stellarAddr,
})

const before = await client.total_deposit({ asset: SEED_ASSET })
const currentNotes = Number(before.result ?? 0n)
const neededNotes = Math.max(0, TARGET_NOTES - currentNotes)
const quadCalls = Math.ceil(neededNotes / 4)

console.log(
  `${SEED_ASSET}: total_deposit = ${currentNotes} note(s), target = ${TARGET_NOTES}, ` +
    `need +${neededNotes} → ${quadCalls} deposit_shielded_quad call(s)`
)

if (quadCalls === 0) {
  console.log("Already at or above target — nothing to do.")
  process.exit(0)
}

const FR_ORDER =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n
function rand(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v % FR_ORDER
}

const { proveDepositQuad } = await import(
  "../../features/shielded-pool/deposit-quad-prover"
)
const quadWasmUrl = `file://${new URL("../../public/circuits-circom/shielded/deposit_quad/deposit.wasm", import.meta.url).pathname}`
const quadZkeyUrl = `file://${new URL("../../public/circuits-circom/shielded/deposit_quad/deposit.zkey", import.meta.url).pathname}`
const keypair = Keypair.fromSecret(stellarSecret)

for (let round = 1; round <= quadCalls; round++) {
  console.log(`Round ${round}/${quadCalls}: generating quad deposit proof…`)
  const salts = [rand(), rand(), rand(), rand()] as [bigint, bigint, bigint, bigint]
  const quadProof = await proveDepositQuad(
    {
      amount: DENOMINATION[SEED_ASSET],
      asset: SEED_ASSET,
      salt: salts,
      sk: identity.skField,
    },
    { wasmUrl: quadWasmUrl, zkeyUrl: quadZkeyUrl }
  )
  const quadMemos = salts.map((salt) =>
    memo.encodeMemoBundle(
      memo.encryptMemo({
        plaintext: {
          amount: DENOMINATION[SEED_ASSET].toString(),
          asset: SEED_ASSET,
          index: 0,
          salt: salt.toString(),
          tree: "deposit",
        },
        recipientPk: identity.publicKey,
      })
    )
  )
  const asm = await client.deposit_shielded_quad({
    from: stellarAddr,
    asset: SEED_ASSET,
    proof: {
      a: Buffer.from(quadProof.a),
      b: Buffer.from(quadProof.b),
      c: Buffer.from(quadProof.c),
      oracle_epoch: BigInt(0),
      public_signals: quadProof.publicSignals.map(bytesUintToBigint),
    },
    memos: quadMemos.map((m) => Buffer.from(m)),
  })
  const sent = await asm.signAndSend({
    signTransaction: (async (xdrToSign: string) => {
      const tx = new stellarSdk.Transaction(xdrToSign, NETWORK_PASSPHRASE)
      tx.sign(keypair)
      return { signedTxXdr: tx.toXDR(), signerAddress: stellarAddr }
    }) as unknown as never,
  })
  const result = sent.result as unknown as
    | { value: unknown }
    | { error: { message: string } }
  if (result && "error" in result) {
    throw new Error(`deposit_shielded_quad reverted: ${result.error.message}`)
  }
  console.log(`  tx: ${sent.sendTransactionResponse?.hash}`)
}

const after = await client.total_deposit({ asset: SEED_ASSET })
console.log(
  `Done. ${SEED_ASSET}: total_deposit = ${Number(after.result ?? 0n)} note(s).`
)

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

function bytesUintToBigint(bytes: Uint8Array): bigint {
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v
}
