// Scans deposit / borrow / repay events on the borrow-pool contract,
// tries to decrypt each attached memo with the wallet's shielded
// identity, and rebuilds the user's note inventory. Runs on wallet
// connect and whenever a new confirmation lands via the borrow-events
// bus, so notes survive fresh browsers / cleared localStorage without
// any explicit backup step.
//
// Event layout (matches contracts/borrow-pool/src/lib.rs):
//   ("deposit", asset)  -> (leafIndex: u64, memoBytes: Bytes)
//
// Later ops will add ("borrow", …) and ("repay", …) with the same
// memo-attached shape so a single scanner covers every tree.

import {
  decodeMemoBundle,
  tryDecryptMemo,
} from "./memo"
import {
  DENOMINATION,
  SUPPORTED_ASSETS,
  computeNullifier,
  type ShieldedAsset,
  type ShieldedNote,
} from "./note"
import { replaceNotes } from "./note-store"

import {
  getConfiguredContractId,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Testnet event retention ≈ 24h @ 5s ledgers. Stay just under.
const LEDGER_LOOKBACK = 16_500

type RpcEvent = {
  contractId?: string
  topic?: unknown[]
  topics?: unknown[]
  value?: unknown
  ledgerClosedAt?: string
}

export function eventOpenedAt(event: {
  ledgerClosedAt?: string
}): number | undefined {
  if (!event.ledgerClosedAt) return undefined
  const ms = Date.parse(event.ledgerClosedAt)
  if (!Number.isFinite(ms)) return undefined
  return Math.floor(ms / 1000)
}

/**
 * Drop notes whose nullifier appears in `spent`. Pure so it can be
 * exercised without spinning up an rpc mock.
 */
export function filterSpentNotes<
  T extends { sk: bigint; index: number }
>(notes: T[], spent: Set<bigint>): T[] {
  return notes.filter((note) => !spent.has(computeNullifier(note.sk, note.index)))
}

export type ScanIdentity = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  skField: bigint
}

/**
 * Fetch every deposit + borrow + withdraw event on the pool contract,
 * decrypt the memos addressed to `identity`, and replace the local
 * note store with the combined inventory. Withdraw + repay events
 * mark their nullifiers so the matching deposit / borrow notes get
 * removed automatically.
 */
export async function scanShieldedNotes(
  identity: ScanIdentity,
  signal?: AbortSignal
): Promise<ShieldedNote[]> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) {
    replaceNotes([])
    return []
  }

  const sdk = await import("@stellar/stellar-sdk")
  const { rpc } = await import("@stellar/stellar-sdk")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const server = new rpc.Server(getConfiguredSorobanRpcUrl(), {
    allowHttp: getConfiguredSorobanRpcUrl().startsWith("http://"),
  })
  const latest = await server.getLatestLedger()
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const startLedger = Math.max(1, latest.sequence - LEDGER_LOOKBACK)
  const depositTopic = sdk.xdr.ScVal.scvSymbol("deposit").toXDR("base64")
  const borrowTopic = sdk.xdr.ScVal.scvSymbol("borrow").toXDR("base64")
  const withdrawTopic = sdk.xdr.ScVal.scvSymbol("withdraw").toXDR("base64")
  const repayTopic = sdk.xdr.ScVal.scvSymbol("repay").toXDR("base64")

  let response: unknown
  try {
    response = await server.getEvents({
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[depositTopic]],
        },
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[borrowTopic]],
        },
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[withdrawTopic]],
        },
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[repayTopic]],
        },
      ],
      startLedger,
      limit: 500,
    })
  } catch {
    replaceNotes([])
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)
  const notes: ShieldedNote[] = []
  const spentNullifiers = new Set<bigint>()

  for (const event of events) {
    const topic = decodeTopicSymbol(sdk, event)
    if (topic === "withdraw") {
      const nullifier = decodeWithdrawNullifier(sdk, event)
      if (nullifier !== null) spentNullifiers.add(nullifier)
      continue
    }
    if (topic === "repay") {
      for (const n of decodeRepayNullifiers(sdk, event)) {
        spentNullifiers.add(n)
      }
      continue
    }
    if (topic !== "deposit" && topic !== "borrow") continue

    const decoded = decodeIndexedEvent(sdk, event)
    if (!decoded) continue

    const bundle = decodeMemoBundle(decoded.memo)
    if (!bundle) continue

    const plaintext = tryDecryptMemo({ bundle, recipientSk: identity.secretKey })
    if (!plaintext) continue

    const asset = plaintext.asset as ShieldedAsset
    if (!(SUPPORTED_ASSETS as readonly string[]).includes(asset)) continue

    const openedAt = eventOpenedAt(event)
    if (topic === "deposit") {
      notes.push({
        amount: DENOMINATION[asset],
        asset,
        index: decoded.index,
        openedAt,
        salt: BigInt(plaintext.salt),
        sk: identity.skField,
        tree: "deposit",
      })
    } else {
      // Borrow memos carry the freshly minted loan-note amount
      // (client-side derived from oracle price × collateral × LTV).
      // Falls back to the denomination if amount is missing.
      const amount =
        typeof plaintext.amount === "string" && plaintext.amount.length > 0
          ? BigInt(plaintext.amount)
          : DENOMINATION[asset]
      notes.push({
        amount,
        asset,
        index: decoded.index,
        openedAt,
        salt: BigInt(plaintext.salt),
        sk: identity.skField,
        tree: "loan",
      })
    }
  }

  const live = filterSpentNotes(notes, spentNullifiers)
  live.sort((a, b) => b.index - a.index)
  replaceNotes(live)
  return live
}

function decodeWithdrawNullifier(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): bigint | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native) || native.length < 1) return null
  const raw = native[0]
  if (raw instanceof Uint8Array) return uintToBigint(raw)
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const bytes = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) bytes[i] = arr[i]
    return uintToBigint(bytes)
  }
  return null
}

function decodeRepayNullifiers(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): bigint[] {
  const value = toScVal(sdk, event.value)
  if (!value) return []
  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return []
  }
  if (!Array.isArray(native) || native.length < 2) return []
  const out: bigint[] = []
  for (let i = 0; i < 2; i++) {
    const raw = native[i]
    const n = rawToBigInt(raw)
    if (n !== null) out.push(n)
  }
  return out
}

function rawToBigInt(raw: unknown): bigint | null {
  if (raw instanceof Uint8Array) return uintToBigint(raw)
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const bytes = new Uint8Array(arr.length)
    for (let i = 0; i < arr.length; i++) bytes[i] = arr[i]
    return uintToBigint(bytes)
  }
  return null
}

function uintToBigint(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function decodeTopicSymbol(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): string | null {
  const list =
    (Array.isArray(event.topic) && event.topic) ||
    (Array.isArray(event.topics) && event.topics) ||
    []
  if (list.length === 0) return null
  const first = toScVal(sdk, list[0])
  if (!first) return null
  try {
    const native = sdk.scValToNative(first)
    return typeof native === "string" ? native : null
  } catch {
    return null
  }
}

function extractEvents(response: unknown): RpcEvent[] {
  if (!response || typeof response !== "object") return []
  const list = (response as { events?: unknown }).events
  return Array.isArray(list) ? (list as RpcEvent[]) : []
}

function decodeIndexedEvent(
  sdk: typeof import("@stellar/stellar-sdk"),
  event: RpcEvent
): { index: number; memo: Uint8Array } | null {
  const value = toScVal(sdk, event.value)
  if (!value) return null

  let native: unknown
  try {
    native = sdk.scValToNative(value)
  } catch {
    return null
  }
  if (!Array.isArray(native)) return null

  // Event body is (index, root, leaf, memo) after Phase 2 upgrade;
  // fall back to the legacy (index, memo) shape so pre-upgrade
  // events still decode until the retention window rolls over.
  let rawIndex: unknown
  let rawMemo: unknown
  if (native.length === 4) {
    rawIndex = native[0]
    rawMemo = native[3]
  } else if (native.length === 2) {
    rawIndex = native[0]
    rawMemo = native[1]
  } else {
    return null
  }

  const index =
    typeof rawIndex === "bigint" ? Number(rawIndex) : Number(rawIndex ?? -1)
  if (!Number.isFinite(index) || index < 0) return null

  const memo = memoBytes(rawMemo)
  if (!memo) return null

  return { index, memo }
}

function memoBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (raw && typeof raw === "object" && "length" in raw) {
    const arr = raw as { length: number; [key: number]: number }
    const out = new Uint8Array(arr.length)
    for (let index = 0; index < arr.length; index++) out[index] = arr[index]
    return out
  }
  return null
}

function toScVal(
  sdk: typeof import("@stellar/stellar-sdk"),
  value: unknown
): InstanceType<typeof sdk.xdr.ScVal> | null {
  if (typeof value === "string") {
    try {
      return sdk.xdr.ScVal.fromXDR(value, "base64")
    } catch {
      return null
    }
  }
  if (value && typeof value === "object" && "toXDR" in value) {
    return value as InstanceType<typeof sdk.xdr.ScVal>
  }
  return null
}
