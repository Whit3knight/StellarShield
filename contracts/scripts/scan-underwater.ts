#!/usr/bin/env bun
/**
 * Watchlist CLI for the shielded pool. Two modes:
 *
 *   Unauthenticated (default): enumerate every borrow event over the
 *   full RPC retention window (merged with indexed events when
 *   EVENTS_API_URL points at the /api/events route), skip
 *   loan_commitments that already appear in a liquidate event, fetch
 *   the on-chain LiquidationBond for the survivors, print them sorted
 *   oldest first. Openings live in encrypted memos and stay opaque —
 *   this only surfaces triage candidates.
 *
 *   Authenticated (LIQUIDATION_SERVICE_SK env set to a 32-byte hex
 *   X25519 secret matching the on-chain LiquidationServicePk slot):
 *   also decrypt each borrow memo, extract the bond openings, fetch
 *   the current Reflector price for the borrow asset, and compute
 *   the same underwater inequality the liquidate circuit enforces:
 *     loan_amount × threshold_bps × borrow_price
 *       > collateral_notional × current_price × 10_000
 *   Underwater bonds are marked with `**` and printed with the ratio.
 *   Still read-only — trigger flow lives in the frontend
 *   `useLiquidate` hook until a signing story lands here.
 *
 * Usage:
 *   bun contracts/scripts/scan-underwater.ts
 *   STELLAR_SHIELD_CONTRACT_ID=... bun contracts/scripts/scan-underwater.ts
 *   EVENTS_API_URL=https://<app>/api/events bun contracts/scripts/scan-underwater.ts
 *   LIQUIDATION_SERVICE_SK=0x... bun contracts/scripts/scan-underwater.ts
 */

import {
  Account,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk"

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { computeCommitment, DENOMINATION, randomFieldElement } from "@/features/notes"
import { deriveShieldedIdentity, encodeMemoBundle, encryptMemo, tryDecryptAnyMemo } from "@/features/notes/memo"
import { fetchAllContractEvents, type RpcEvent } from "@/features/notes/rpc-events"
import { proveLiquidateV2 } from "@/features/shielded-pool/liquidate-v2-prover"

const CONTRACT =
  process.env.STELLAR_SHIELD_CONTRACT_ID ??
  process.env.NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID ??
  "CBVBVB6LGQJYO2KTIHB6VMJEZ3CHHC4KPIJ7EATV4SR7CTC7TUE6PM2P"
const RPC_URL =
  process.env.STELLAR_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org"
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

const REFLECTOR_CEX =
  process.env.STELLAR_REFLECTOR_CEX_CONTRACT_ID ??
  "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63"

const TRIGGER = process.argv.includes("--trigger")
const LIQUIDATOR_SECRET = process.env.LIQUIDATOR_SECRET?.trim()

const REPO_ROOT = resolve(__dirname, "..", "..")
const LIQ_V2_WASM = resolve(
  REPO_ROOT,
  "public/circuits-circom/shielded/liquidate-v2/liquidate.wasm"
)
const LIQ_V2_ZKEY = resolve(
  REPO_ROOT,
  "public/circuits-circom/shielded/liquidate-v2/liquidate.zkey"
)

// Fixed 8500 bps default matches contract's initialize_shielded call.
// Optional env override for staging deployments with tighter limits.
const LIQUIDATION_THRESHOLD_BPS = Number(
  process.env.LIQUIDATION_THRESHOLD_BPS ?? "8500"
)

function loadServiceSecret(): Uint8Array | null {
  const raw = process.env.LIQUIDATION_SERVICE_SK?.trim()
  if (!raw) return null
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw
  if (hex.length !== 64) {
    throw new Error(
      `LIQUIDATION_SERVICE_SK must be 32 hex bytes; got ${hex.length / 2}`
    )
  }
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// Read-only source; the all-zeros ed25519 address satisfies
// TransactionBuilder for preflight-only simulateTransaction. Must be a
// checksum-valid strkey or `new Account()` throws "accountId is invalid".
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

const SUPPORTED_ASSETS = ["XLM", "USDC", "EURC"] as const

type LiquidationBond = {
  borrow_amount_commit: Uint8Array
  collateral_value_commit: Uint8Array
  borrow_price_commit: Uint8Array
  borrow_asset_tag: bigint | number
  collateral_asset_tag: bigint | number
  oracle_epoch: bigint | number
  opened_at: bigint | number
}

async function main(): Promise<void> {
  const server = new rpc.Server(RPC_URL, {
    allowHttp: RPC_URL.startsWith("http://"),
  })
  console.log(
    `contract=${CONTRACT}\nrpc=${RPC_URL}\nscanning full RPC retention window` +
      `${process.env.EVENTS_API_URL ? " + indexer" : ""}\n`
  )

  const borrowTopic = xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const liquidateTopic = xdr.ScVal.scvSymbol("liquidat").toXDR("base64")

  const [borrowEvents, liquidateEvents] = await Promise.all([
    fetchAllContractEvents({ server, filters: baseFilter(borrowTopic) }),
    fetchAllContractEvents({ server, filters: baseFilter(liquidateTopic) }),
  ])

  const liquidated = new Set<string>()
  for (const event of liquidateEvents) {
    const commit = decodeLiquidateLoanCommit(event)
    if (commit) liquidated.add(bytesToHex(commit))
  }

  const serviceSk = loadServiceSecret()
  const authenticated = serviceSk !== null
  console.log(
    authenticated
      ? "mode=authenticated (decrypting memos + computing HF)"
      : "mode=watchlist (bond metadata only)"
  )
  console.log("")

  const commitments: {
    commit: Uint8Array
    ledgerClosedAt?: string
    memo?: Uint8Array
  }[] = []
  for (const event of borrowEvents) {
    const decoded = decodeBorrowEvent(event)
    if (!decoded) continue
    if (liquidated.has(bytesToHex(decoded.commit))) continue
    commitments.push({
      commit: decoded.commit,
      ledgerClosedAt: event.ledgerClosedAt,
      memo: decoded.memo,
    })
  }

  console.log(
    `found ${commitments.length} live bonds (${liquidated.size} liquidated within lookback)\n`
  )

  const rows: {
    commit: Uint8Array
    bond: LiquidationBond
    openedAt: number
    underwater?: boolean
    hfRatio?: number
  }[] = []

  const priceCache = new Map<string, bigint>()
  const fetchPrice = async (asset: string): Promise<bigint | null> => {
    if (priceCache.has(asset)) return priceCache.get(asset)!
    const price = await fetchReflectorPrice(server, asset)
    if (price !== null) priceCache.set(asset, price)
    return price
  }

  for (const { commit, memo } of commitments) {
    const bond = await fetchBond(server, commit)
    if (!bond) continue
    const openedAt = Number(bond.opened_at)
    const borrowAsset =
      SUPPORTED_ASSETS[Number(bond.borrow_asset_tag)] ?? null

    let underwater: boolean | undefined
    let hfRatio: number | undefined
    if (authenticated && memo && borrowAsset) {
      const opened = decryptOpenings(memo, serviceSk!)
      if (opened) {
        const priceNow = await fetchPrice(borrowAsset)
        if (priceNow !== null) {
          const check = checkUnderwater({
            loanAmount: opened.loanAmount,
            collateralNotional: opened.collateralNotional,
            borrowPrice: opened.borrowPrice,
            priceNow,
          })
          underwater = check.underwater
          hfRatio = check.hfRatio
        }
      }
    }

    rows.push({ commit, bond, openedAt, underwater, hfRatio })
  }

  // Sort underwater first (if authenticated), then oldest.
  rows.sort((a, b) => {
    if (authenticated) {
      const au = a.underwater ? 1 : 0
      const bu = b.underwater ? 1 : 0
      if (au !== bu) return bu - au
    }
    return a.openedAt - b.openedAt
  })

  const now = Math.floor(Date.now() / 1000)
  console.log(
    "loan_commit            borrow  collateral  opened_at              age    hf"
  )
  console.log(
    "-------------------------------------------------------------------------------"
  )
  for (const { commit, bond, openedAt, underwater, hfRatio } of rows) {
    const commitLabel =
      bytesToHex(commit).slice(0, 8) + "…" + bytesToHex(commit).slice(-4)
    const borrowAsset =
      SUPPORTED_ASSETS[Number(bond.borrow_asset_tag)] ?? "?"
    const collateralAsset =
      SUPPORTED_ASSETS[Number(bond.collateral_asset_tag)] ?? "?"
    const openedIso = new Date(openedAt * 1000).toISOString()
    const age = formatAge(now - openedAt)
    const hfLabel =
      hfRatio !== undefined
        ? `${underwater ? "** " : "   "}${hfRatio.toFixed(2)}x`
        : "-"
    console.log(
      `${commitLabel.padEnd(20)}  ${borrowAsset.padEnd(6)}  ${collateralAsset.padEnd(10)}  ${openedIso}  ${age.padEnd(5)}  ${hfLabel}`
    )
  }

  if (authenticated) {
    const underwaterCount = rows.filter((r) => r.underwater).length
    console.log(
      `\n${underwaterCount} underwater bond${underwaterCount === 1 ? "" : "s"} flagged.`
    )
    if (TRIGGER && underwaterCount > 0) {
      if (!LIQUIDATOR_SECRET) {
        console.error(
          "--trigger requires LIQUIDATOR_SECRET env (Stellar secret key, S...)"
        )
        process.exit(1)
      }
      await triggerAll(server, serviceSk!, rows, commitments)
    } else if (underwaterCount > 0) {
      console.log("Rerun with --trigger + LIQUIDATOR_SECRET to auto-liquidate.")
    }
  }
}

async function triggerAll(
  server: rpc.Server,
  serviceSk: Uint8Array,
  rows: Array<{
    commit: Uint8Array
    bond: LiquidationBond
    underwater?: boolean
  }>,
  commitments: Array<{ commit: Uint8Array; memo?: Uint8Array }>
): Promise<void> {
  const sdk = await import("@stellar/stellar-sdk")
  const bindings = await import("@/features/protocol/bindings/borrow-pool")
  const wasm = new Uint8Array(readFileSync(LIQ_V2_WASM))
  const zkey = new Uint8Array(readFileSync(LIQ_V2_ZKEY))
  const keypair = sdk.Keypair.fromSecret(LIQUIDATOR_SECRET!)
  const liquidator = keypair.publicKey()
  console.log(`liquidator=${liquidator}`)

  const client = new bindings.Client({
    contractId: CONTRACT,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: liquidator,
  })

  const memoByCommit = new Map<string, Uint8Array>()
  for (const c of commitments) {
    if (c.memo) memoByCommit.set(bytesToHex(c.commit), c.memo)
  }

  const liquidatorIdentity = deriveShieldedIdentity(serviceSk)
  // Liquidator note key derived from the service sk so bounties are
  // recoverable by whoever holds the service secret. Fresh salt per
  // note keeps individual bounties unlinkable.
  const liquidatorPoseidonSk = bigintFromBytes(liquidatorIdentity.secretKey)

  for (const row of rows) {
    if (!row.underwater) continue
    const commitHex = bytesToHex(row.commit)
    const memo = memoByCommit.get(commitHex)
    if (!memo) {
      console.log(`skip ${commitHex.slice(0, 8)}… — no memo captured`)
      continue
    }
    const openings = decryptOpenings(memo, serviceSk)
    if (!openings) {
      console.log(`skip ${commitHex.slice(0, 8)}… — memo decrypt failed`)
      continue
    }
    const borrowAsset = SUPPORTED_ASSETS[Number(row.bond.borrow_asset_tag)]
    const collateralAsset =
      SUPPORTED_ASSETS[Number(row.bond.collateral_asset_tag)]
    if (!borrowAsset || !collateralAsset) continue

    const priceNow = await fetchReflectorPrice(server, borrowAsset)
    if (priceNow === null) {
      console.log(`skip ${commitHex.slice(0, 8)}… — Reflector unavailable`)
      continue
    }

    const nullifierFetch = await client.loan_nullifier({
      loan_commitment: Buffer.from(row.commit),
    })
    const sidecarNullifier = nullifierFetch.result
    if (!sidecarNullifier) {
      console.log(
        `skip ${commitHex.slice(0, 8)}… — no LoanNullifier sidecar (pre-A bond)`
      )
      continue
    }

    console.log(`liquidating ${commitHex.slice(0, 8)}… (${borrowAsset})`)
    const proof = await proveLiquidateV2(
      {
        loanAmount: openings.loanAmount,
        bondSaltAmount: openings.bondSaltAmount,
        collateralNotional: openings.collateralNotional,
        bondSaltValue: openings.bondSaltValue,
        borrowPrice: openings.borrowPrice,
        bondSaltPrice: openings.bondSaltPrice,
        currentPrice: priceNow,
        thresholdBps: LIQUIDATION_THRESHOLD_BPS,
      },
      { wasm, zkey }
    )

    const bountySalt = randomFieldElement()
    const bountyAmount = DENOMINATION[collateralAsset]
    const bountyCommitment = computeCommitment({
      amount: bountyAmount,
      asset: collateralAsset,
      salt: bountySalt,
      sk: liquidatorPoseidonSk,
    })
    const bountyMemo = encodeMemoBundle(
      encryptMemo({
        plaintext: {
          amount: bountyAmount.toString(),
          asset: collateralAsset,
          index: 0,
          salt: bountySalt.toString(),
          tree: "deposit",
        },
        recipientPk: liquidatorIdentity.publicKey,
      })
    )

    const nowSecs = BigInt(Math.floor(Date.now() / 1000))
    const proofBuffers = {
      a: Buffer.from(proof.a),
      b: Buffer.from(proof.b),
      c: Buffer.from(proof.c),
      oracle_epoch: nowSecs,
      public_signals: proof.publicSignals.map(bigintFromBytes),
    }

    try {
      const assembled = await client.liquidate_shielded_v2({
        liquidator,
        borrow_asset: borrowAsset,
        collateral_asset: collateralAsset,
        loan_commitment: Buffer.from(row.commit),
        loan_nullifier: Buffer.from(sidecarNullifier as Uint8Array),
        proof: proofBuffers,
        bounty_commit: Buffer.from(bigintTo32Bytes(bountyCommitment)),
        bounty_memo: Buffer.from(bountyMemo),
      })
      const sent = await assembled.signAndSend({
        signTransaction: async (xdrToSign: string) => {
          const tx = sdk.TransactionBuilder.fromXDR(xdrToSign, NETWORK_PASSPHRASE)
          tx.sign(keypair)
          return { signedTxXdr: tx.toXDR(), signerAddress: liquidator }
        },
      })
      const hash = sent.sendTransactionResponse?.hash ?? "?"
      console.log(`  ✓ tx ${hash}`)
    } catch (err) {
      console.log(
        `  ✗ ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function bigintTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let residue = value
  for (let index = 31; index >= 0; index--) {
    out[index] = Number(residue & 0xffn)
    residue >>= 8n
  }
  return out
}

type BorrowEventDecoded = {
  commit: Uint8Array
  memo?: Uint8Array
}

function decodeBorrowEvent(event: RpcEvent): BorrowEventDecoded | null {
  const value = toScVal(event.value)
  if (!value) return null
  let native: unknown
  try {
    native = scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 3) return null
  const commit = coerceBytes(native[2])
  if (!commit) return null
  const memo = native.length >= 4 ? coerceBytes(native[3]) ?? undefined : undefined
  return { commit, memo }
}

function decryptOpenings(
  memo: Uint8Array,
  serviceSk: Uint8Array
): {
  loanAmount: bigint
  collateralNotional: bigint
  borrowPrice: bigint
  bondSaltAmount: bigint
  bondSaltValue: bigint
  bondSaltPrice: bigint
} | null {
  const plaintext = tryDecryptAnyMemo({ raw: memo, recipientSk: serviceSk })
  if (!plaintext || plaintext.tree !== "loan" || !plaintext.bond) return null
  try {
    return {
      loanAmount: BigInt(plaintext.amount),
      collateralNotional: BigInt(plaintext.bond.collateralValue),
      borrowPrice: BigInt(plaintext.bond.oraclePrice),
      bondSaltAmount: BigInt(plaintext.bond.saltAmount),
      bondSaltValue: BigInt(plaintext.bond.saltValue),
      bondSaltPrice: BigInt(plaintext.bond.saltPrice),
    }
  } catch {
    return null
  }
}

function checkUnderwater(inputs: {
  loanAmount: bigint
  collateralNotional: bigint
  borrowPrice: bigint
  priceNow: bigint
}): { underwater: boolean; hfRatio: number } {
  const lhs =
    inputs.loanAmount * BigInt(LIQUIDATION_THRESHOLD_BPS) * inputs.borrowPrice
  const rhs = inputs.collateralNotional * inputs.priceNow * 10_000n
  const underwater = lhs > rhs
  // hf_ratio = collateral_value_now / (loan_amount * threshold)
  //          = (collateral_notional * priceNow) / (loan_amount * threshold * borrowPrice / 10_000)
  //          = rhs / lhs
  const hfRatio = lhs === 0n ? Infinity : Number(rhs) / Number(lhs)
  return { underwater, hfRatio }
}

async function fetchReflectorPrice(
  server: rpc.Server,
  ticker: string
): Promise<bigint | null> {
  const source = new Account(SIMULATION_SOURCE, "0")
  const contract = new Contract(REFLECTOR_CEX)
  const assetScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    xdr.ScVal.scvSymbol(ticker),
  ])
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("lastprice", assetScVal))
    .setTimeout(30)
    .build()
  try {
    const sim = await server.simulateTransaction(tx)
    const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval
    if (!retval) return null
    const native = scValToNative(retval) as { price?: bigint } | null
    if (!native || typeof native.price === "undefined") return null
    return BigInt(native.price)
  } catch {
    return null
  }
}

function baseFilter(topic: string): rpc.Api.EventFilter[] {
  // Soroban's getEvents requires the topic filter array length to
  // match the emitted event's topic count exactly. Borrow events are
  // (topic, collateral_asset, borrow_asset) — 3 slots. Liquidate is
  // (topic, borrow_asset) — 2 slots. Widen so the CLI actually sees
  // them; pre-fix, both were dropped and every scan returned 0.
  return [
    {
      type: "contract",
      contractIds: [CONTRACT],
      topics: [[topic, "*", "*"]],
    },
    {
      type: "contract",
      contractIds: [CONTRACT],
      topics: [[topic, "*"]],
    },
  ]
}

function decodeLiquidateLoanCommit(event: RpcEvent): Uint8Array | null {
  const value = toScVal(event.value)
  if (!value) return null
  let native: unknown
  try {
    native = scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 1) return null
  return coerceBytes(native[0])
}

async function fetchBond(
  server: rpc.Server,
  commit: Uint8Array
): Promise<LiquidationBond | null> {
  const source = new Account(SIMULATION_SOURCE, "0")
  const contract = new Contract(CONTRACT)
  const arg = xdr.ScVal.scvBytes(Buffer.from(commit))
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("liquidation_bond", arg))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval
  if (!retval) return null
  try {
    const native = scValToNative(retval)
    if (!native) return null
    return native as LiquidationBond
  } catch {
    return null
  }
}

function toScVal(value: unknown): xdr.ScVal | null {
  if (typeof value === "string") {
    try {
      return xdr.ScVal.fromXDR(value, "base64")
    } catch {
      return null
    }
  }
  if (value && typeof value === "object" && "toXDR" in value) {
    return value as xdr.ScVal
  }
  return null
}

function coerceBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const out = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) out[i] = arr[i]
    return out
  }
  return null
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86_400)}d`
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
