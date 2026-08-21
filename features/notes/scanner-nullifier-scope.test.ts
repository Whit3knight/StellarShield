// Regression guard — `nullifier = Poseidon(sk, leaf_index)` carries no
// tree or asset domain separation (see the docstring on
// `nullifiersByTreeAndAsset` in scanner.ts), and leaf counters restart
// per (tree, asset) on chain. The spent set is therefore keyed by
// `(asset, tree, nullifier)` the way contract storage is; when it was a
// flat Set<bigint>, one spend permanently tombstoned every live note
// sharing that leaf index in every other tree and asset.

import { describe, expect, it } from "vitest"

import { computeNullifier, type ShieldedNote } from "./note"
import {
  carryOverNotes,
  markSpentNotes,
  notesBeyondRpcRetention,
  spentKey,
} from "./scanner"

const SK = 42n

// Leaf indices restart per (tree, asset) on-chain — the contract reads
// `deposit_next_index(&env, &asset)`. So the same wallet legitimately
// owns XLM deposit leaf 0, USDC deposit leaf 0, and XLM loan leaf 0 at
// the same time, and all three share one nullifier value.
const note = (
  asset: ShieldedNote["asset"],
  tree: ShieldedNote["tree"],
  index: number
): ShieldedNote => ({
  amount: asset === "XLM" ? 10_000_000n : 5_000_000n,
  asset,
  index,
  openedAt: 1_700_000_000,
  salt: BigInt(index + 1),
  sk: SK,
  tree,
})

describe("nullifier domain separation in the local spent set", () => {
  it("the same bytes really do recur across trees and assets", () => {
    expect(computeNullifier(SK, 0)).toBe(computeNullifier(SK, 0))
    // Nothing in the value distinguishes XLM-deposit-0 from USDC-deposit-0.
    const xlmDeposit0 = note("XLM", "deposit", 0)
    const usdcDeposit0 = note("USDC", "deposit", 0)
    expect(computeNullifier(xlmDeposit0.sk, xlmDeposit0.index)).toBe(
      computeNullifier(usdcDeposit0.sk, usdcDeposit0.index)
    )
  })

  it("withdrawing XLM deposit 0 leaves USDC deposit 0 alone", () => {
    // One ("withdraw", XLM) event → one nullifier, scoped to the
    // (XLM, deposit) namespace the contract marked it in.
    const spent = new Set([spentKey("XLM", "deposit", computeNullifier(SK, 0))])
    const held = [note("XLM", "deposit", 0), note("USDC", "deposit", 0)]

    const marked = markSpentNotes(held, spent)
    expect(marked.map((n) => `${n.asset}:${n.spent === true}`)).toEqual([
      "XLM:true",
      "USDC:false", // never withdrawn; still on-chain and spendable
    ])
  })

  it("SHOULD leave the USDC note live after an XLM withdraw", () => {
    const spent = new Set([spentKey("XLM", "deposit", computeNullifier(SK, 0))])
    const marked = markSpentNotes(
      [note("XLM", "deposit", 0), note("USDC", "deposit", 0)],
      spent
    )
    expect(marked[1].spent).not.toBe(true)
  })

  it("a borrow's 4 collateral nullifiers touch only the collateral asset", () => {
    // borrow_shielded spends XLM deposit leaves 0..3. The borrow event
    // publishes exactly those four nullifiers under topic 1 =
    // collateral_asset, so they scope to (XLM, deposit).
    const spent = new Set(
      [0, 1, 2, 3].map((index) =>
        spentKey("XLM", "deposit", computeNullifier(SK, index))
      )
    )
    const held = [
      ...[0, 1, 2, 3].map((i) => note("XLM", "deposit", i)),
      ...[0, 1, 2, 3].map((i) => note("USDC", "deposit", i)),
    ]

    const marked = markSpentNotes(held, spent)
    // All four XLM notes burned, all four USDC notes untouched.
    expect(marked.filter((n) => n.asset === "XLM" && n.spent === true)).toHaveLength(4)
    expect(
      marked.filter((n) => n.asset === "USDC" && n.spent !== true)
    ).toHaveLength(4)
  })

  it("SHOULD keep all four USDC notes live after an XLM borrow", () => {
    const spent = new Set(
      [0, 1, 2, 3].map((index) =>
        spentKey("XLM", "deposit", computeNullifier(SK, index))
      )
    )
    const marked = markSpentNotes(
      [
        ...[0, 1, 2, 3].map((i) => note("XLM", "deposit", i)),
        ...[0, 1, 2, 3].map((i) => note("USDC", "deposit", i)),
      ],
      spent
    )
    expect(
      marked.filter((n) => n.asset === "USDC" && n.spent !== true)
    ).toHaveLength(4)
  })

  it("repaying XLM loan 0 does not tombstone XLM deposit 0", () => {
    // repay_shielded burns loan leaf 0 and deposit leaf 5, and the event
    // reports them positionally so each lands in its own tree's
    // namespace. The loan nullifier shares bytes with the untouched
    // deposit note at leaf 0 — different namespace, so no collision.
    const spent = new Set([
      spentKey("XLM", "loan", computeNullifier(SK, 0)),
      spentKey("XLM", "deposit", computeNullifier(SK, 5)),
    ])
    const held = [
      note("XLM", "loan", 0),
      note("XLM", "deposit", 5),
      note("XLM", "deposit", 0), // collateral the user still owns
    ]

    const marked = markSpentNotes(held, spent)
    expect(marked.map((n) => n.spent === true)).toEqual([true, true, false])
  })

  it("a liquidation burns the loan note, not the same-index deposit note", () => {
    // ("liquidat", borrow_asset) body carries the LOAN nullifier.
    const spent = new Set([spentKey("XLM", "loan", computeNullifier(SK, 2))])
    const marked = markSpentNotes(
      [note("XLM", "loan", 2), note("XLM", "deposit", 2)],
      spent
    )
    expect(marked.map((n) => n.spent === true)).toEqual([true, false])
  })

  it("the tombstone is still permanent — no rescan ever clears it", () => {
    // markSpentNotes only ever sets spent, never unsets it, and
    // note-store persists it. That is why the scoping has to be right on
    // the way in: a later scan with a correct (empty) spent set leaves
    // any tombstone already written in place.
    const alreadySpent = { ...note("USDC", "deposit", 0), spent: true }
    expect(markSpentNotes([alreadySpent], new Set())[0].spent).toBe(true)
    expect(carryOverNotes([alreadySpent], new Set(), new Set())[0].spent).toBe(
      true
    )
  })
})

describe("notesBeyondRpcRetention boundaries", () => {
  const now = 10_000_000
  const week = 7 * 24 * 60 * 60
  const base = note("XLM", "deposit", 0)

  it("is exclusive at the cutoff itself", () => {
    const atCutoff = { ...base, openedAt: now - week }
    const oneSecondOlder = { ...base, index: 1, openedAt: now - week - 1 }
    expect(notesBeyondRpcRetention([atCutoff], now)).toEqual([])
    expect(notesBeyondRpcRetention([oneSecondOlder], now)).toHaveLength(1)
  })

  it("skips notes with no openedAt — every locally minted note", () => {
    // use-deposit.ts / use-borrow.ts build notes without openedAt; only
    // a scan that sees the mint event backfills it. A note minted while
    // the indexer was already down never gets one, so the very notes
    // most at risk are the ones excluded from the warning.
    const local: ShieldedNote = { ...base, openedAt: undefined }
    expect(notesBeyondRpcRetention([local], now)).toEqual([])
  })

  it("skips spent tombstones and legacy zero-amount notes", () => {
    const old = now - week - 1
    const notes: ShieldedNote[] = [
      { ...base, index: 0, openedAt: old, spent: true },
      { ...base, index: 1, openedAt: old, amount: 0n }, // isSpentNote
      { ...base, index: 2, openedAt: old },
    ]
    expect(notesBeyondRpcRetention(notes, now).map((n) => n.index)).toEqual([2])
  })

  it("does not flag a future-dated openedAt", () => {
    expect(
      notesBeyondRpcRetention([{ ...base, openedAt: now + 3_600 }], now)
    ).toEqual([])
  })
})
