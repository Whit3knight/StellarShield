// Client-side orchestrator for a shielded deposit. Runs end-to-end:
//   1. Generate a fresh salt + derive the note's commitment.
//   2. Ask the deposit prover for a Groth16 witness.
//   3. Sign + send `deposit_shielded` via the borrow-pool bindings,
//      attaching the encrypted memo so the note can be rediscovered
//      after localStorage loss.
//
// Returns the leaf index the pool assigned. The caller records the
// note client-side (via `upsertNote`) so it appears in future scans
// without having to decrypt the memo again.

import {
  DEPTH,
  append,
  computeCommitment,
  encodeMemoBundle,
  encryptMemo,
  DENOMINATION,
  randomFieldElement,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

import { proveDeposit } from "./deposit-prover"

export type DepositParams = {
  account: string
  asset: ShieldedAsset
  // The address-derived shielded identity from `useShieldedPool` /
  // `useShieldedIdentity`. Passed through as-is — DO NOT wrap in
  // another `deriveShieldedIdentity` call. Doing so double-hashes
  // the seed and produces a pubkey the scanner can't decrypt notes
  // for, so every deposited note goes silently invisible.
  identity: {
    publicKey: Uint8Array
    skField: bigint
  }
  wasmUrl?: string
  zkeyUrl?: string
}

export type DepositResult = {
  index: number
  note: ShieldedNote
  txHash: string
}

/**
 * Prepare (but don't submit) a shielded deposit. Returns the proof
 * payload + memo bytes ready to feed the bindings' `deposit_shielded`
 * call. Kept separate so a wallet-signing step can slot in between
 * proof generation and RPC submit.
 */
export async function prepareDeposit(params: DepositParams): Promise<{
  memo: Uint8Array
  note: ShieldedNote
  proof: Awaited<ReturnType<typeof proveDeposit>>
}> {
  const denomination = DENOMINATION[params.asset]
  const sk = params.identity.skField
  const salt = randomFieldElement()

  const proof = await proveDeposit(
    {
      amount: denomination,
      asset: params.asset,
      salt,
      sk,
    },
    { wasmUrl: params.wasmUrl, zkeyUrl: params.zkeyUrl }
  )

  // Fetch the current deposit frontier + next_index BEFORE submitting
  // so we can compute this leaf's Merkle inclusion witness locally
  // and pin it on the note. Later spend paths (borrow / withdraw)
  // then read `note.witness` instead of replaying deposit events —
  // which fail once Soroban RPC drops the enabling event past its
  // ~24h retention window.
  const contractId = getConfiguredContractId()
  let witness: ShieldedNote["witness"] | undefined
  let leafIndexHint = 0
  if (contractId) {
    try {
      const bindings = await import("@/features/protocol/bindings/borrow-pool")
      const client = new bindings.Client({
        contractId,
        networkPassphrase: getConfiguredNetworkPassphrase(),
        rpcUrl: getConfiguredSorobanRpcUrl(),
        publicKey: params.account,
      })
      const [nextIndexTx, frontierTx] = await Promise.all([
        client.deposit_next_index({ asset: params.asset }),
        client.deposit_frontier({ asset: params.asset }),
      ])
      const nextIndex = Number(nextIndexTx.result ?? 0n)
      const frontierRaw = (frontierTx.result ?? []) as Uint8Array[]
      // Pad up to DEPTH — pre-Track-D deposits may return fewer
      // entries; every unfilled slot is the empty subtree hash.
      const frontier: bigint[] = new Array(DEPTH).fill(0n)
      for (let i = 0; i < frontierRaw.length && i < DEPTH; i++) {
        frontier[i] = bytesToBigInt(frontierRaw[i])
      }
      const leaf = computeCommitment({
        amount: denomination,
        asset: params.asset,
        salt,
        sk,
      })
      const { path, root } = append({
        frontier,
        leaf,
        nextIndex,
      })
      const pathBits: number[] = []
      let cursor = nextIndex
      for (let level = 0; level < DEPTH; level++) {
        pathBits.push(cursor & 1)
        cursor >>= 1
      }
      leafIndexHint = nextIndex
      witness = { pathElements: path, pathBits, root }
    } catch {
      // best-effort: witness stays undefined, spend paths fall back
      // to event replay (still works within retention).
    }
  }

  const note: ShieldedNote = {
    amount: denomination,
    asset: params.asset,
    index: leafIndexHint, // authoritative index arrives with the tx result
    salt,
    sk,
    tree: "deposit",
    witness,
  }

  const memoBundle = encryptMemo({
    plaintext: {
      amount: denomination.toString(),
      asset: params.asset,
      index: 0,
      salt: salt.toString(),
      tree: "deposit",
    },
    recipientPk: params.identity.publicKey,
  })

  return {
    memo: encodeMemoBundle(memoBundle),
    note,
    proof,
  }
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}
