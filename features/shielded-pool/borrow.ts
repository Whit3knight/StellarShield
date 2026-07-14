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
  encodeMemoBundle,
  encodeMemoBundleMulti,
  encryptMemo,
  encryptMemoMulti,
  randomFieldElement,
  type ShieldedAsset,
  type ShieldedNote,
} from "@/features/notes"
import { fetchReflectorPrice } from "@/features/markets/prices"
import { getLiquidationServicePk } from "@/features/protocol/liquidation-service"

import { proveBorrow, validateCollateralNotes } from "./borrow-prover"
import { fetchDepositWitnesses } from "./withdraw-tree"

export type PrepareBorrowParams = {
  account: string
  borrowAsset: ShieldedAsset
  collateralAsset: ShieldedAsset
  collateralNotes: ShieldedNote[] // exactly 4
  hfMinBps: number
  maxLtvBps: number
  // Address-derived shielded identity from useShieldedPool /
  // useShieldedIdentity. Pass through directly — do NOT rewrap via
  // deriveShieldedIdentity, that double-hashes the seed and desyncs
  // the borrow-side memo pubkey from the scanner's.
  identity: {
    publicKey: Uint8Array
    skField: bigint
  }
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

  const sk = params.identity.skField

  // Borrow always recomputes witnesses from the CURRENT tree state via
  // event replay. Per-note witnesses cached at deposit-time (by
  // `prepareDeposit`) each carry the root that was current the moment
  // that leaf was appended — every subsequent deposit shifts the root
  // upward, so mixing cached witnesses across four notes yields four
  // different roots and the circuit rejects the inclusion proof. The
  // cache is still useful for withdraw / single-note flows where root
  // consistency isn't across multiple witnesses.
  //
  // Retry the fetch a few times in case Soroban RPC's event index
  // hasn't caught up with the last just-confirmed deposit — the tx
  // landed synchronously (that's how we know the leaf index), we just
  // need the RPC to see it.
  const highestNeededIndex = params.collateralNotes.reduce(
    (max, note) => Math.max(max, note.index),
    -1
  )
  const wantedIndices = new Set(params.collateralNotes.map((n) => n.index))
  let fallbackWitnesses: Awaited<ReturnType<typeof fetchDepositWitnesses>> = []
  for (let attempt = 0; attempt < 4; attempt++) {
    fallbackWitnesses = await fetchDepositWitnesses(
      params.collateralAsset,
      undefined,
      wantedIndices
    )
    const highestSeen = fallbackWitnesses.reduce(
      (max, w) => Math.max(max, w.leafIndex),
      -1
    )
    if (highestSeen >= highestNeededIndex) break
    if (attempt === 3) break
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  const matched = params.collateralNotes.map((note) => {
    const commitment = computeCommitment({
      amount: note.amount,
      asset: note.asset,
      salt: note.salt,
      sk: note.sk,
    })
    const witness = fallbackWitnesses.find(
      (candidate) =>
        candidate.leafIndex === note.index && candidate.leaf === commitment
    )
    if (!witness) {
      const byIndex = fallbackWitnesses.find(
        (candidate) => candidate.leafIndex === note.index
      )
      const detail = JSON.stringify({
        noteIndex: note.index,
        noteAsset: note.asset,
        noteAmount: note.amount.toString(),
        noteSalt: note.salt.toString(),
        noteSk: note.sk.toString(),
        expectedCommitment: commitment.toString(),
        fallbackCount: fallbackWitnesses.length,
        fallbackLeavesByIndex: fallbackWitnesses
          .slice()
          .sort((a, b) => a.leafIndex - b.leafIndex)
          .map((w) => ({
            leafIndex: w.leafIndex,
            leaf: w.leaf.toString(),
          })),
        chainLeafAtNoteIndex: byIndex ? byIndex.leaf.toString() : null,
      })
      console.error("[borrow] witness miss\n" + detail)
      throw new Error(
        `No matching deposit event for note #${note.index}. See console for diagnostic.`
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
  const bondSaltAmount = randomFieldElement()
  const bondSaltValue = randomFieldElement()
  const bondSaltPrice = randomFieldElement()

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
      bondSaltAmount,
      bondSaltValue,
      bondSaltPrice,
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

  const totalCollateral = params.collateralNotes.reduce(
    (acc, n) => acc + n.amount,
    0n
  )
  const plaintext = {
    amount: proof.borrowAmount.toString(),
    asset: params.borrowAsset,
    index: 0,
    salt: borrowSalt.toString(),
    tree: "loan" as const,
    bond: {
      saltAmount: bondSaltAmount.toString(),
      saltValue: bondSaltValue.toString(),
      saltPrice: bondSaltPrice.toString(),
      collateralValue: (totalCollateral * oraclePrice).toString(),
      oraclePrice: oraclePrice.toString(),
      collateralAsset: params.collateralAsset,
    },
  }

  const servicePk = await getLiquidationServicePk()
  const memo = servicePk
    ? encodeMemoBundleMulti(
        encryptMemoMulti({
          plaintext,
          recipientPks: [params.identity.publicKey, servicePk],
        })
      )
    : encodeMemoBundle(
        encryptMemo({ plaintext, recipientPk: params.identity.publicKey })
      )

  // Silence unused import — DENOMINATION consumed via validateCollateralNotes.
  void DENOMINATION

  return {
    memo,
    note,
    proof,
  }
}

