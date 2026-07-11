// Client-side orchestrator for a shielded borrow.
//   1. Pick N=4 deposit notes of the collateral asset the user owns.
//   2. Reconstruct the deposit tree from events to derive inclusion
//      witnesses for those 4 notes.
//   3. Fetch the current Reflector price for collateral in
//      borrow-asset units.
//   4. Generate the borrow proof (~10-15s, biggest circuit).
//   5. Encrypt the new loan note's metadata into a memo bundle so the
//      borrower can recover it after localStorage loss.

import {
  DENOMINATION,
  computeCommitment,
  deriveShieldedIdentity,
  encodeMemoBundle,
  encryptMemo,
  randomFieldElement,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { fetchReflectorPrice } from "@/features/markets/prices"

import { proveBorrow, validateCollateralNotes } from "./borrow-prover"
import { fetchDepositWitnesses } from "./withdraw-tree"

export type PrepareBorrowParams = {
  account: string
  borrowAsset: ShieldedAsset
  collateralAsset: ShieldedAsset
  collateralNotes: ShieldedNote[] // exactly 4
  hfMinBps: number
  maxLtvBps: number
  walletSeed: Uint8Array
  wasmUrl?: string
  zkeyUrl?: string
}

export type PrepareBorrowResult = {
  memo: Uint8Array
  note: ShieldedNote
  proof: Awaited<ReturnType<typeof proveBorrow>>
}

/**
 * Everything the caller needs to submit a borrow_shielded tx, minus
 * the wallet-signing step. Left as a pure async function so the hook
 * can slot Freighter signing in between.
 */
export async function prepareBorrow(
  params: PrepareBorrowParams
): Promise<PrepareBorrowResult> {
  validateCollateralNotes(params.collateralNotes, params.collateralAsset)

  const identity = deriveShieldedIdentity(params.walletSeed)
  const sk = bytesToBigInt(identity.secretKey)

  // Fetch inclusion witnesses for all 4 collateral notes.
  const witnesses = await fetchDepositWitnesses(params.collateralAsset)
  const matched = params.collateralNotes.map((note) => {
    const commitment = computeCommitment({
      amount: note.amount,
      asset: note.asset,
      salt: note.salt,
      sk: note.sk,
    })
    const witness = witnesses.find(
      (candidate) =>
        candidate.leafIndex === note.index && candidate.leaf === commitment
    )
    if (!witness) {
      throw new Error(
        `No matching deposit event for note #${note.index}. Tree may have advanced beyond retention.`
      )
    }
    return witness
  })

  const depositRoot = matched[0]?.root
  if (depositRoot === undefined) {
    throw new Error("borrow prep: no deposit witnesses derived")
  }
  const rootsAgree = matched.every((witness) => witness.root === depositRoot)
  if (!rootsAgree) {
    throw new Error(
      "borrow prep: collateral notes span different tree roots. Refresh and retry."
    )
  }

  // Fetch Reflector price for the collateral asset in whole-unit
  // integers. If Reflector is unreachable, fall back to a 1:1 price
  // (used mostly for local demos on testnet without price data).
  const priceRecord = await fetchReflectorPrice(params.collateralAsset).catch(
    () => null
  )
  const oraclePrice =
    priceRecord && priceRecord.price > 0n ? priceRecord.price : 1n

  const borrowSalt = randomFieldElement()

  const proof = await proveBorrow(
    {
      borrowAsset: params.borrowAsset,
      borrowSalt,
      collateralAsset: params.collateralAsset,
      collateralNotes: params.collateralNotes,
      collateralPaths: matched.map((witness) => witness.pathElements),
      collateralBits: matched.map((witness) => witness.pathBits),
      depositRoot,
      hfMinBps: params.hfMinBps,
      maxLtvBps: params.maxLtvBps,
      oraclePrice,
      sk,
    },
    { wasmUrl: params.wasmUrl, zkeyUrl: params.zkeyUrl }
  )

  const note: ShieldedNote = {
    amount: proof.borrowAmount,
    asset: params.borrowAsset,
    index: 0, // filled after tx returns the loan-tree leaf index
    salt: borrowSalt,
    sk,
    tree: "loan",
  }

  const memoBundle = encryptMemo({
    plaintext: {
      amount: proof.borrowAmount.toString(),
      asset: params.borrowAsset,
      index: 0,
      salt: borrowSalt.toString(),
      tree: "loan",
    },
    recipientPk: identity.publicKey,
  })

  // Silence unused import — DENOMINATION consumed via validateCollateralNotes.
  void DENOMINATION

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
