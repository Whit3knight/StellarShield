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
}

export type ScanIdentity = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  skField: bigint
}

/**
 * Fetch every deposit event on the pool contract, attempt decryption
 * against `identity`, replace the local note store with the results.
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

  let response: unknown
  try {
    response = await server.getEvents({
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
          topics: [[depositTopic]],
        },
      ],
      startLedger,
      limit: 200,
    })
  } catch {
    replaceNotes([])
    return []
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const events = extractEvents(response)
  const notes: ShieldedNote[] = []

  for (const event of events) {
    const decoded = decodeDepositEvent(sdk, event)
    if (!decoded) continue

    const bundle = decodeMemoBundle(decoded.memo)
    if (!bundle) continue

    const plaintext = tryDecryptMemo({ bundle, recipientSk: identity.secretKey })
    if (!plaintext) continue // event not addressed to this wallet

    const asset = plaintext.asset as ShieldedAsset
    if (!(SUPPORTED_ASSETS as readonly string[]).includes(asset)) continue

    notes.push({
      amount: DENOMINATION[asset],
      asset,
      index: decoded.index,
      salt: BigInt(plaintext.salt),
      sk: identity.skField,
      tree: "deposit",
    })
  }

  notes.sort((a, b) => b.index - a.index)
  replaceNotes(notes)
  return notes
}

function extractEvents(response: unknown): RpcEvent[] {
  if (!response || typeof response !== "object") return []
  const list = (response as { events?: unknown }).events
  return Array.isArray(list) ? (list as RpcEvent[]) : []
}

function decodeDepositEvent(
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
