// QA probe — adversarial coverage for the note store's identity key and
// for `resetNotes()`'s storageKey lifecycle (commit 81399b2).
//
// Both defects these tests pinned are fixed: `upsertNote` keys on
// (tree, index, asset), and `resetNotes(account)` sweeps every
// `stellar-shield:notes:v1:` row for that account instead of the single
// key this session happened to point at.

import { beforeEach, describe, expect, it } from "vitest"

import type { ShieldedNote } from "./note"
import {
  configureNotePersistence,
  resetNotes,
  snapshotLiveNotes,
  snapshotNotes,
  upsertNote,
} from "./note-store"
import { dedupeNotes } from "./scanner"

const CONTRACT = "CCONTRACT"

let accountSeq = 0
const freshAccount = () => `GCOLLIDE${accountSeq++}`

// Leaf indices are per-(tree, asset) on-chain: the contract calls
// `state::deposit_next_index(&env, &asset)`, so the XLM deposit tree and
// the USDC deposit tree BOTH start at leaf 0. These are two distinct,
// simultaneously-spendable notes.
const xlmLeaf0: ShieldedNote = {
  amount: 10_000_000n,
  asset: "XLM",
  index: 0,
  openedAt: 1_700_000_000,
  salt: 111n,
  sk: 7n,
  tree: "deposit",
}
const usdcLeaf0: ShieldedNote = {
  amount: 5_000_000n,
  asset: "USDC",
  index: 0,
  openedAt: 1_700_000_100,
  salt: 222n,
  sk: 7n,
  tree: "deposit",
}

describe("upsertNote identity key", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetNotes()
    configureNotePersistence(CONTRACT, freshAccount())
  })

  it("keeps a USDC leaf 0 and an XLM leaf 0 side by side", () => {
    upsertNote(xlmLeaf0)
    upsertNote(usdcLeaf0)

    const held = snapshotNotes()
    expect(held).toHaveLength(2)
    // The XLM note's salt lives only here and in its on-chain memo.
    expect(held.some((n) => n.salt === 111n)).toBe(true)
    expect(held.some((n) => n.salt === 222n)).toBe(true)
  })

  it("agrees with the scanner's own `${asset}:${tree}:${index}` key", () => {
    expect(dedupeNotes([xlmLeaf0, usdcLeaf0])).toHaveLength(2)
    upsertNote(xlmLeaf0)
    upsertNote(usdcLeaf0)
    expect(snapshotNotes()).toHaveLength(2)
  })

  it("still replaces in place when the same note is upserted twice", () => {
    upsertNote(xlmLeaf0)
    upsertNote({ ...xlmLeaf0, spent: true })
    const held = snapshotNotes()
    expect(held).toHaveLength(1)
    expect(held[0].spent).toBe(true)
  })

  it("does not tombstone a live XLM note when a USDC note at the same leaf is spent", () => {
    upsertNote(xlmLeaf0)
    // use-borrow.ts:286 / use-withdraw.ts:185 / use-repay.ts:253 all do this.
    upsertNote({ ...usdcLeaf0, spent: true })
    const live = snapshotLiveNotes()
    expect(live.map((n) => n.asset)).toEqual(["XLM"])
  })

  it("persists both notes — they survive a reload", () => {
    const account = freshAccount()
    configureNotePersistence(CONTRACT, account)
    upsertNote(xlmLeaf0)
    upsertNote(usdcLeaf0)

    // Reload: point elsewhere, then back.
    configureNotePersistence(CONTRACT, freshAccount())
    configureNotePersistence(CONTRACT, account)
    expect(snapshotNotes().map((n) => n.asset).sort()).toEqual(["USDC", "XLM"])
  })

  it("separates the loan tree's per-asset indices too", () => {
    upsertNote({ ...xlmLeaf0, tree: "loan" })
    upsertNote({ ...usdcLeaf0, tree: "loan" })
    expect(snapshotNotes()).toHaveLength(2)
  })
})

describe("resetNotes storageKey lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetNotes()
  })

  it("removes the localStorage row it was pointed at", () => {
    const account = freshAccount()
    const key = `stellar-shield:notes:v1:${CONTRACT}:${account}`
    configureNotePersistence(CONTRACT, account)
    upsertNote(xlmLeaf0)
    expect(window.localStorage.getItem(key)).not.toBeNull()

    resetNotes()
    expect(window.localStorage.getItem(key)).toBeNull()
    expect(snapshotNotes()).toEqual([])
  })

  it("re-hydrates on the next configure, including the same key", () => {
    const account = freshAccount()
    configureNotePersistence(CONTRACT, account)
    upsertNote(xlmLeaf0)
    resetNotes()
    // Same (contract, account): the `key === storageKey` early return
    // must NOT fire, because resetNotes nulled storageKey.
    configureNotePersistence(CONTRACT, account)
    expect(snapshotNotes()).toEqual([])
    upsertNote(usdcLeaf0)
    expect(
      window.localStorage.getItem(
        `stellar-shield:notes:v1:${CONTRACT}:${account}`
      )
    ).not.toBeNull()
  })

  it("silently drops writes made between resetNotes and the next configure", () => {
    const account = freshAccount()
    const key = `stellar-shield:notes:v1:${CONTRACT}:${account}`
    configureNotePersistence(CONTRACT, account)
    resetNotes()

    // A confirmation landing in this window (use-deposit's upsertNote)
    // reaches memory but never storage: storageKey is null.
    upsertNote(xlmLeaf0)
    expect(snapshotNotes()).toHaveLength(1)
    expect(window.localStorage.getItem(key)).toBeNull()

    // ...and the next configure silently discards it. Known and narrow:
    // reset only runs on disconnect-and-forget, where discarding a note
    // is the point. A deposit confirming inside that window is lost.
    configureNotePersistence(CONTRACT, account)
    expect(snapshotNotes()).toEqual([])
  })

  it("reaches note stores written under a previous contract id", () => {
    // Three testnet redeploys landed in the last week (ba81702, 09471e9,
    // 680f846). Each one leaves its own row behind, and every row holds
    // `sk` — the note spending key — in plaintext.
    const account = freshAccount()
    const oldKey = `stellar-shield:notes:v1:COLDCONTRACT:${account}`
    configureNotePersistence("COLDCONTRACT", account)
    upsertNote(xlmLeaf0)
    configureNotePersistence(CONTRACT, account)
    upsertNote(usdcLeaf0)

    resetNotes(account)

    expect(
      window.localStorage.getItem(`stellar-shield:notes:v1:${CONTRACT}:${account}`)
    ).toBeNull()
    expect(window.localStorage.getItem(oldKey)).toBeNull()
  })

  it("purges the account's rows even if configureNotePersistence never ran", () => {
    // useShieldedPool only configures once `identity` resolves, and that
    // is an async Freighter signMessage. Forgetting before it lands must
    // still clear the previous session's row — it holds `sk`.
    const account = freshAccount()
    const key = `stellar-shield:notes:v1:${CONTRACT}:${account}`
    window.localStorage.setItem(
      key,
      JSON.stringify([
        { amount: "10000000", asset: "XLM", index: 0, salt: "111", sk: "7", tree: "deposit" },
      ])
    )

    resetNotes(account) // storageKey is null — the sweep still finds it

    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it("leaves another account's rows alone", () => {
    const mine = freshAccount()
    const theirs = freshAccount()
    const theirKey = `stellar-shield:notes:v1:${CONTRACT}:${theirs}`
    window.localStorage.setItem(theirKey, "[]")
    configureNotePersistence(CONTRACT, mine)
    upsertNote(xlmLeaf0)

    resetNotes(mine)

    expect(
      window.localStorage.getItem(`stellar-shield:notes:v1:${CONTRACT}:${mine}`)
    ).toBeNull()
    expect(window.localStorage.getItem(theirKey)).not.toBeNull()
  })
})
