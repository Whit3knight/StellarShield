#!/usr/bin/env bun
/**
 * Sanity check for the scanner's spent-detection path.
 *
 * Runs the same steps `hydrateSpentFromChain` in
 * `features/notes/scanner.ts` runs:
 *   1. Fetch every deposit event for XLM on the configured contract.
 *   2. Attempt to decrypt each memo with the deployer's shielded
 *      identity, keeping the notes that decrypt.
 *   3. Compute each note's nullifier `Poseidon(sk, index)`.
 *   4. Call the contract's `nullifiers_used` bulk view.
 *   5. Print the per-note (index, chain-flagged-spent) table.
 *
 * If the view reports `true` for a note that the UI is still treating
 * as spendable, the failure is client-side (scanner not called,
 * bindings marshalling wrong, cache stale). If the view reports
 * `false`, the failure is contract-side (Poseidon impl mismatch, etc.).
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
    // env may already be exported
  }
}

const CONTRACT_ID = required("NEXT_PUBLIC_STELLAR_SHIELD_CONTRACT_ID")
const RPC_URL = required("NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL")
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
const COLLATERAL_ASSET = "XLM"

const stellarAddr = stellarCli(["keys", "address", "deployer"])
if (!stellarAddr) throw new Error("deployer key not found")
console.log("Deployer:", stellarAddr)

const memo = await import("../../features/notes/memo")
const { computeNullifier } = await import("../../features/notes/note")
const stellarSdk: typeof import("@stellar/stellar-sdk") = await import(
  "@stellar/stellar-sdk"
)
const bindingsModule = await import(
  "../../features/protocol/bindings/borrow-pool"
)
const {
  rpc: { Server: RpcServer },
  xdr,
  scValToNative,
} = stellarSdk

const identity = await deriveIdentity(stellarAddr)
const server = new RpcServer(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") })
const latest = await server.getLatestLedger()
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
  startLedger: Math.max(1, latest.sequence - 10_000),
  limit: 500,
})
const events = (rawResp as { events?: unknown[] }).events ?? []
console.log(`Deposit events: ${events.length}`)

const owned: { index: number; nullifier: bigint }[] = []
for (const event of events as { value?: unknown }[]) {
  const value = toScVal(event.value)
  if (!value) continue
  const native = scValToNative(value) as unknown[]
  if (!Array.isArray(native) || native.length !== 4) continue
  const index = Number(native[0])
  const memoBytes = new Uint8Array(native[3] as ArrayBuffer)
  const opened = memo.tryDecryptAnyMemo({
    raw: memoBytes,
    recipientSk: identity.secretKey,
  })
  if (!opened || opened.tree !== "deposit") continue
  const nullifier = computeNullifier(identity.skField, index)
  owned.push({ index, nullifier })
}
console.log(`Own deposits decrypted: ${owned.length}`)
if (owned.length === 0) {
  console.log("Nothing to check.")
  process.exit(0)
}

const client = new bindingsModule.Client({
  contractId: CONTRACT_ID,
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  publicKey: stellarAddr,
})
const buffers = owned.map((o) => Buffer.from(bigintTo32BytesBE(o.nullifier)))
const tx = await client.nullifiers_used({ nullifiers: buffers })
const flags = (tx.result ?? []) as boolean[]
console.log("index | nullifier(hex prefix) | spent?")
for (let i = 0; i < owned.length; i++) {
  const hex = bigintTo32BytesBE(owned[i].nullifier)
    .slice(0, 8)
    .reduce((acc, b) => acc + b.toString(16).padStart(2, "0"), "")
  console.log(
    `${owned[i].index.toString().padStart(5)} | ${hex}…             | ${flags[i]}`
  )
}
const liveCount = flags.filter((f) => !f).length
console.log(
  `\n${liveCount} spendable deposit note(s) remain / ${owned.length} total.`
)
process.exit(0)

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
function bigintTo32BytesBE(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let v = value
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}
