# Shielded liquidation design

Status: **draft, not implemented**. Ratifies the approach for Track L. Written
after Phase 2 v1 shipped (deposit/borrow/withdraw/repay). See
`README.md` → `## Deferred` for the current gap.

## Problem

Anyone must be able to close an underwater loan without knowing the
borrower's identity or the exact per-note amounts of other borrowers.
Existing Zcash-style constructions have no liquidation primitive — Zcash
doesn't lend. Aztec-style shielded lending uses viewing keys or public
metadata as escape hatches.

Non-negotiable constraints from the product USP:

1. Borrower wallet address never linkable on chain.
2. Amounts of healthy positions never revealed.
3. Anyone (not just protocol admin) can trigger liquidation.
4. Verifier is Groth16 over BLS12-381 via Soroban Protocol 22 host fns.

## Options considered

**Option A — public per-position amounts.**
Store `(loan_amount, collateral_notional)` publicly at borrow-time. Trivial
liquidation logic. Rejected: violates constraint 2 for *every* position,
not just underwater ones.

**Option B — viewing keys.**
Borrower encrypts opening data with a symmetric key derived from a
per-borrow shared secret; publishes the ciphertext + a stealth pubkey.
Liquidator-pool participants attempt decrypt off-chain. Rejected for v1:
requires an off-chain participant network and stealth-address plumbing —
too much surface for one track.

**Option C — soft timelock only.**
Loans expire after N days; expiry lets protocol invalidate the loan
commitment. No per-position risk check. Rejected as v1 primary
mechanism — doesn't handle acute price drops, only stale positions.
May ship *alongside* Option D as a secondary safety net.

**Option D — public borrow-time commitment + zk range proof (chosen).**
Borrower publishes at borrow-time a *bounded* public commitment tuple:

```
LiquidationBond {
  loan_commitment,               // already public (in loan tree)
  borrow_amount_commitment,      // Poseidon(borrow_amount, salt_a)
  collateral_value_commitment,   // Poseidon(collateral_notional_at_borrow, salt_c)
  borrow_asset_tag,
  collateral_asset_tag,
  oracle_price_epoch,            // Reflector epoch used for pricing
  borrow_price_commitment,       // Poseidon(borrow_price_at_open, salt_p)
}
```

Only openings for the amount commitments are needed to check health.
Openings can be exposed publicly *only when* the position becomes
liquidatable. Path chosen: openings live in the encrypted memo the
borrower already publishes; a liquidator with the openings can trigger.

Bootstrap the opening problem via one of two sub-options:

- **D1 (chosen for v1)** — borrower encrypts openings to a
  well-known "liquidation service" pubkey published in contract storage.
  Any protocol participant running the service can decrypt + trigger.
  Trades trust vs. tractability: not fully permissionless, but privacy
  survives *unless* the service acts (i.e., unless a position needs
  liquidating). Similar in spirit to Zcash sapling's viewing keys.
- **D2 (post-v1)** — decentralize the service via threshold decryption
  (Frost / TSS). Same on-chain shape.

## Chosen data flow (Option D + D1)

### Borrow-time (extends `borrow_shielded`)

Public signals added to the borrow circuit:

```
[N]     borrow_amount_commitment    Poseidon(borrow_amount, salt_borrow)
[N+1]   collateral_value_commitment Poseidon(collateral_notional, salt_coll)
[N+2]   borrow_price_commitment     Poseidon(borrow_price, salt_price)
```

Contract stores `LiquidationBond` keyed by `loan_commitment`. Memo grows
to include `{salt_borrow, salt_coll, salt_price}` alongside the existing
`{amount, salt, index}`. Memo is *additionally* encrypted to the
liquidation-service pubkey (dual-recipient ECDH — the borrower key and
the service key both decrypt).

### Liquidation-time (`liquidate_shielded`)

Public signals of the liquidate circuit:

```
[0] loan_commitment_hash            binds the proof to a specific bond
[1] current_price_commitment        Poseidon(current_price, price_salt, current_epoch)
[2] liquidation_threshold_bps       matches contract's risk_params
[3] liquidator_bounty_commitment    Poseidon(bounty_amount, bounty_asset_tag, liquidator_pk, bounty_salt)
[4] loan_nullifier                  spent atomically with liquidation
```

Private witness:

```
loan_amount, salt_borrow
collateral_notional, salt_coll
borrow_price, salt_price
current_price, price_salt
current_debt      = loan_amount × current_price / borrow_price   // 1e18 fixed
bounty_amount, bounty_salt
```

Constraints:

1. Reconstruct + assert `borrow_amount_commitment`, `collateral_value_commitment`, `borrow_price_commitment` match on-chain bond (public inputs after `loan_commitment_hash` lookup).
2. Reconstruct + assert `current_price_commitment` matches oracle-issued commitment (Reflector Pulse commitment cross-check, same pattern as borrow circuit).
3. `current_debt × 10_000 > collateral_notional × current_price × liquidation_threshold_bps` (range proof, ~40k constraints for 128-bit values).
4. `bounty_amount = collateral_notional × current_price × liquidation_bonus_bps / 10_000`, awarded via `liquidator_bounty_commitment` (a new deposit note minted to liquidator's `sk`).
5. `loan_nullifier = Poseidon(sk_borrower, loan_index)` where `sk_borrower` is *private witness supplied by the liquidation service* (it decrypted the memo).

Contract:

- Verifies Groth16.
- Cross-checks bond openings.
- Marks `loan_nullifier` used.
- Appends `liquidator_bounty_commitment` to the collateral-asset deposit tree.
- Emits `("liquidate", collateral_asset)` with `(loan_nullifier, liquidator_pk, ledger_time)`.

## Storage additions

```rust
LiquidationBond(loan_commitment_bytes) -> LiquidationBond
LiquidationServicePk -> BytesN<32>          // set by admin, rotatable
```

## Migration

- Existing loans (opened before Track L ships) have no bond. Grandfather
  them: contract accepts them as non-liquidatable. Borrowers who want
  liquidation-eligible terms can repay + reborrow after upgrade.
- Bond storage bloat: ~200 bytes per active loan. At 100 loans, ~20 KB —
  well within Stellar rent economics.

## Estimated scope

| Phase | Sesi | Deliverable |
| --- | --- | --- |
| 1 | 1 | Ratify design (this doc → PR review); pick D1 vs D2. |
| 2 | 1 | Extend borrow circuit + memo encryption (dual recipient). Redeploy. |
| 3 | 2-3 | Liquidate circuit (range proof + oracle commitment + bounty commitment). |
| 4 | 1 | Contract `liquidate_shielded` + storage + verifier bytes. Upgrade in place. |
| 5 | 1-2 | Liquidation service (off-chain worker) + trigger UI. |

Realistic total: **5-8 sesi**. Matches the earlier Phase 2 plan estimate.

## Post-implementation gap (2026-07-11)

The v1 ship shipped everything on the borrower side: bond commitments
in the borrow circuit, `LiquidationBond` in contract storage,
`liquidate_shielded` fn, `useLiquidate` hook + drawer button.
Borrowers can self-liquidate their own underwater positions end-to-end.

**A permissionless off-chain service worker as originally sketched
under Option D1 does not work yet.** The gap:

- The liquidate circuit binds the nullifier as `Poseidon(sk, loan_index)`
  where `sk` is the borrower's wallet-derived Poseidon secret.
- To prove liquidation, a service holding the borrower's `sk` can also
  compute nullifiers for *every other note the borrower owns* —
  deposits, other loans — and spend them. Sharing `sk` with a
  liquidation service therefore drains the borrower's wallet.
- The dual-recipient memo currently carries the bond openings
  (`saltAmount`, `saltValue`, `saltPrice`, `collateralValue`,
  `oraclePrice`) but **not** `sk`. If we added `sk` we would ship the
  drain vector; if we don't add it, the service can't prove.

Two clean fixes, both explicit follow-up tracks:

1. **Zcash sapling-style key split.** Borrower's shielded identity
   splits into `ivk` (incoming viewing) + `nk` (nullifier deriving).
   The liquidate circuit binds `nullifier = PRF(nk, loan_index)`
   instead of `Poseidon(sk, loan_index)`. Per-loan `nk` shared to the
   service only lets it burn *that* loan's nullifier — no other notes
   at risk. Cost: circom circuit rewrite for deposit + borrow +
   withdraw + repay + liquidate (all nullifier consumers), state
   migration for existing notes, redesigned scanner. ~3–5 sesi.
2. **Threshold decryption (D2 in the original doc).** Service key
   shards across N parties via FROST or similar; K-of-N cooperate to
   decrypt bond openings, then any single participant proves + submits
   with a *fresh, per-liquidation* borrower-supplied opening blob that
   avoids revealing `sk`. Requires an off-chain MPC layer plus circuit
   changes similar to option 1. ~5–8 sesi.

Track L status therefore: **v1 shipped (self-liquidate). Service
worker deferred until one of the above lands.** The
`LiquidationServicePk` slot + dual-recipient memo + prover machinery
built during Track L are the prerequisites for either follow-up —
none of it is wasted work.

## Track A design (2026-07-12) — pre-published loan nullifier

After the D1 gap surfaced above, the "sapling ivk/nk split" fix was
scoped in generic terms. This section pins the concrete design so
the next implementation session starts from a ratified spec rather
than open exploration.

### Chosen scheme

Bind the loan nullifier to the loan commitment (not the tree index),
publish it at borrow-time, and let the liquidator supply it as a
public input the contract cross-checks against storage. No sk in the
liquidate circuit.

```
borrow_commitment = Poseidon(borrow_amount, borrow_asset_tag, sk, borrow_salt)
loan_nullifier    = Poseidon(sk, borrow_commitment)
```

Why bind to `borrow_commitment` and not the tree `leaf_index`:

- The borrower doesn't know their leaf index at proof time — it's
  assigned by the contract when the tx executes. Binding to
  `borrow_commitment` makes the nullifier fully determined by the
  witness the borrower already computes.
- Commitment is unique per note (different salt = different
  commitment), so nullifier stays unique per loan.
- Same PRF key (sk) across every loan the borrower holds — sharing
  sk still lets an attacker derive every loan's nullifier, so sk
  stays private.

### Circuit changes

- **Borrow circuit** gains one new public signal `loan_nullifier`
  and one new constraint `Poseidon(sk, borrow_commitment) === loan_nullifier`.
  Constraint cost: 1 Poseidon(2) ≈ 240 non-linear. Fits in the
  current pot17 with wide headroom.
- **Withdraw-loan (currently the withdraw circuit reused via
  `withdraw_loan_shielded`)** — the leaf-index nullifier binding
  stays. The stored `loan_nullifier` is a *pre-declaration*; the
  borrower still proves ownership via `Poseidon(sk, leaf_index)` at
  withdraw time. This means loan-tree withdraw + liquidate use
  *different* nullifiers for the same note. Both get marked on
  spend; either burns the note. Fine on solvency (double-marking is
  a no-op).
  - Simpler alternative to explore during implementation: rewrite
    withdraw-loan to also use `Poseidon(sk, borrow_commitment)`, so
    a single nullifier gates both paths. Requires a new circuit
    (can't reuse withdraw). Deferred to implementation session.
- **Liquidate circuit** drops the `Poseidon(sk, loan_index) === loan_nullifier`
  constraint entirely. Public signal `loan_nullifier` becomes an
  opaque value; contract does the binding via storage. Circuit's
  underwater math + bond-opening reconstruction stays as-is.

### Storage

Do **not** grow `LiquidationBond`. Existing bonds (Track L v1) fail
to decode if the struct changes — every live loan becomes
un-liquidatable.

Add a sidecar slot:

```rust
enum PersistentKey {
    ...existing...,
    LoanNullifier(BytesN<32>),  // key = loan_commitment
}
```

Written by the new borrow path. Absent for pre-A borrows.

### Contract

`liquidate_shielded` reads the sidecar. Three cases:

| Bond present | LoanNullifier present | Path |
|--------------|----------------------|------|
| yes | yes | New. Contract cross-checks `proof.public_signals[6] == LoanNullifier(loan_commit)`. Service-triggerable. |
| yes | no | Grandfathered Track L v1 bond. Contract falls back to the old liquidate circuit path (proof binds `Poseidon(sk, loan_index)`). Only borrower can self-liquidate. |
| no | — | InvalidProof, as today. |

Migration = zero-op: old bonds keep working via the fallback; new
bonds enable service triggering.

### Follow-up work

- Ship a new **shielded-liquidate-v2** circuit for the new path;
  keep the current one for grandfathered bonds. Both verifiers stay
  in the contract until the retention window rolls old bonds off.
- The dual-recipient memo already carries the openings the service
  needs (`saltAmount`, `saltValue`, `saltPrice`, `collateralValue`,
  `oraclePrice`). No memo schema change for A.
- **Track B (FROST)** would layer on top of this: shard the service
  key across N parties. Design here removes the sk-drain, so B is a
  pure decentralization pass — no additional circuit changes.

### Session budget (revised from 3-5 sesi)

1. Extend borrow circuit + rebuild + verifier bytes + LoanNullifier
   storage slot + contract wires bond + sidecar → ~1 sesi.
2. New `shielded-liquidate-v2` circuit + verifier + `liquidate_shielded`
   branch → ~1 sesi.
3. TS prover + hook wiring (service-side path) + scanner extension
   → ~1 sesi.

Total ~3 sesi (was 3-5). Migration risk removed by the sidecar
storage decision.

## Open questions

- **Service key rotation.** If the liquidation-service pubkey rotates,
  do old bonds re-encrypt? Simplest answer: bonds stay valid, but must
  also be encrypted to *any* historical key still authorized. Admin
  maintains a small ring of authorized keys.
- **Bounty asset.** Award as a deposit note in the collateral asset (as
  spec'd above) — simplest. Alternative: award as fungible chain tokens
  transferred directly to `liquidator_pk`, which breaks liquidator
  privacy. Kept as note-mint for now.
- **Griefing.** A dishonest service could sit on decrypted openings.
  Only relevant post-v1 when we move to D2 threshold decryption; add a
  slashing / reputation layer there.
- **Timelock fallback.** Ship optional soft-expiry (`LoanOpenedAt` +
  N-day term) alongside D1 so the pool doesn't accumulate dead bonds
  if the liquidation service is offline. Small, orthogonal — add if
  Phase 2 verification catches stale-loan cases.

## Explicit non-goals for Track L v1

- Fully decentralized (threshold-decrypted) liquidation. Post-v1.
- Partial liquidation. All liquidations close the full loan.
- Cross-market liquidation (e.g. XLM collateral → USDC repay via swap).
  All liquidations happen in the collateral asset only.
