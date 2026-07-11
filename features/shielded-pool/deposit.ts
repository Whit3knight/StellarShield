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
  deriveShieldedIdentity,
  encodeMemoBundle,
  encryptMemo,
  DENOMINATION,
  randomFieldElement,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"

import { proveDeposit } from "./deposit-prover"

export type DepositParams = {
  account: string
  asset: ShieldedAsset
  walletSeed: Uint8Array
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
  const identity = deriveShieldedIdentity(params.walletSeed)
  const sk = bytesToBigInt(identity.secretKey)
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

  const note: ShieldedNote = {
    amount: denomination,
    asset: params.asset,
    index: 0, // filled after the tx returns the leaf index
    salt,
    sk,
    tree: "deposit",
  }

  const memoBundle = encryptMemo({
    plaintext: {
      amount: denomination.toString(),
      asset: params.asset,
      index: 0,
      salt: salt.toString(),
      tree: "deposit",
    },
    recipientPk: identity.publicKey,
  })

  return {
    memo: encodeMemoBundle(memoBundle),
    note,
    proof,
  }
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}
