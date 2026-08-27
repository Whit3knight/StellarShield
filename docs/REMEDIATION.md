# Stellar Shield — Remediation Plan

**Version:** 1.0 | **Date:** 2026-07-13 | **Status:** M1–M3 complete; M4 gated
**Companion docs:** [BRD.md](./BRD.md) (risks R1–R16, open questions OQ-1–8), [PRD.md](./PRD.md) (test gaps §7).

> **Progress (2026-07-13):** M1 (docs honest), M2 (trustworthy build), and M3
> (privacy works) are done and committed. Resolved: R1, R2, R3-disclosure,
> R6, R7-stopgap, R8, R9, R15, R16, plus a live-pricing strkey bug. Remaining
> work is M4 (§Part 4), all gated to a mainnet decision.
>
> **Read [Part 5 — Superseded notes](#part-5--superseded-notes-append-only)
> first.** Parts 1–4 are preserved as written on 2026-07-13 and are now stale in
> four places: the canonical contract ID (S1), the unit domain (S2), where
> solvency is enforced (S3), and whether liquidation works at all (S4).

**Context held constant:** single developer, testnet only, no real value at risk.
The goal is **docs that tell the truth and a build that catches its own
regressions** — not mainnet hardening. Everything gated to a mainnet decision
(audit, trusted-setup ceremony, admin multisig, legal position) stays gated and
is not scheduled here.

All file paths verified against the working tree.

---

## Part 1 — Milestones (execution spine)

Sequenced by dependency and leverage, not severity. Docs first (hours), safety
net second (it pays for every later change), privacy third (the biggest code
item), mainnet gates never — until a mainnet decision exists.

| | Milestone | Closes | Size |
|---|---|---|---|
| M1 | Make docs honest | R15, R16, R3 (disclosure), R7 (stopgap), OQ-4, OQ-6, OQ-7 | 1–2 days |
| M2 | Trustworthy testnet build | R6, R8, PRD gaps 4/5/2, R9 | 1–2 weeks |
| M3 | Privacy actually works (mechanically) | R1, R2 | 2–3 weeks |
| M4 | Mainnet-gate prerequisites | R5, R7 (real), R11, R12, R14, Rust tests | **Gated — not scheduled** |
| — | Parked | R4, R10, R13, OQ-1, FROST | see §4 |

### M1 — Make docs honest (this week)

Goal: every doc statement matches the code. No code changes except deletions.
M2/M3 decisions get made against these docs, so they must be true first.

1. Declare canonical contract ID; make README and `.env.local` agree (R16). **Blocks M2 harness target.**
2. Reconcile README interest-accrual contradiction (R15).
3. Refresh CLAUDE.md (done); delete stale mock comments in `features/protocol/types.ts` and retired `borrow-eligibility-circom` (R16, OQ-1).
4. Disclosure paragraph: liquidation operator has pool-wide viewing capability (R3); identity address-derived until R1; recovery window-bounded until R2 (R7 stopgap too).
5. Decide OQ-4 (deposit-quad: one README roadmap row), OQ-6 (who holds service SK), OQ-7 (gitignore `.zkey`/`.ptau`/`node_modules` now — 10 min).

**Done when:** README, CLAUDE.md, `.env.local` agree with code and each other; git status clean of build artifacts; R3 trust model written down.

### M2 — Trustworthy testnet build

Goal: a regression net for the bug class that already bit three times, **before**
M3 touches identity derivation and circuits. Hard constraint: **e2e harness lands
before any further circuit/crypto change.**

1. **Wire `contracts/scripts/e2e-borrow.ts` into a harness** (R6). Add the missing deposit leg so a run needs only a funded key. Scheduled workflow, not PR-blocking. Highest-ROI item in the plan.
2. **R8 supply chain:** shared hash-pinned artifact loader + `snarkjs` exact pin + drop unused `circomlibjs`.
3. Prover public-signal-ordering test (gap 4) — exact class of a past hotfix.
4. `quote.ts` tests (gap 5) — pure math, an afternoon.
5. Hook tests for the two branchy paths only: borrow preflight nullifier-exclusion + liquidate v2/v1 branch (gap 2, narrowed).
6. Nonce-derivation review/hardening (R9) — while touching crypto fixtures.

**Skipped deliberately:** oracle-path tests (gap 6), CLI/wrapper tests (gaps 7/8) — add when one bites. Rust tests blocked on soroban-sdk 23.

**Done when:** one command runs deposit→borrow→verify against testnet and fails loudly on encoding/ordering/budget regressions; artifacts hash-verified; quote + preflight unit-tested.

### M3 — Privacy actually works (mechanically)

Goal: close the two "code contradicts the claim" criticals. After M3 the
*mechanism* is sound; anonymity-set size (R4) remains a volume problem, not code.

1. **Decide OQ-2 first** (accept per-session Freighter signature popup?). Free decision, gates R1. Recommendation: accept — a privacy product that isn't private has no UX to protect.
2. **R1: signature-based identity derivation** with locally-cached secret + legacy recovery identity for pre-fix notes. Biggest code change. M2 harness is its safety net.
3. **R2: promote backup flow** (staleness badge + window-truncation flag + dual-identity import). Ships with/after R1 (backup key changes with identity).

**Hard constraint:** R1 gates any unqualified privacy claim. Until it ships, no doc/demo says "private" without the R1 caveat (M1 installs it, M3 removes it).

**Done when:** identity requires a signature (secret input); fresh browser recovers funds via backup regardless of RPC window; artifacts hash-verified; harness green.

---

## Part 2 — Per-finding technical detail

### R1 — Shielded identity from public address [CRITICAL]

**Root cause.** `use-shielded-identity.ts:56-64` seeds identity with `SHA-256("stellar-shield:" + address)` — pure public data. `memo.ts:228-234` derives the X25519 keypair from it, and `scanner.ts:241` uses `identity.skField` directly as the note spending key. So this is **spend-key derivation from a public address**, not just a memo leak.

**Fix.**
1. Seed = `SHA-256(signature)` where signature is Freighter `signMessage` over a fixed canonical message (`stellar-shield:identity:v2:<network-passphrase>`). Ed25519 deterministic → same wallet, same seed, no per-note state.
2. **Cache without reintroducing the weakness:** persist the derived 32-byte secret in `localStorage` keyed by address. Not the old weakness — the cached value can't be recomputed from public data, and `note-store.ts` already persists note `sk` at rest, so the threat model is unchanged. One popup per fresh browser profile, zero after. Answers the dev's UX objection.
3. **Migration:** reuse the existing legacy-identity trial-decrypt pattern (`scanner.ts:197-250`). Keep the address-derived identity as a recovery-only identity in the trial-decrypt list; new memos encrypt to the signature-derived pk. Plumb through `ScanIdentity` (`scanner.ts:66-70`).
4. Rename `shieldedIdentityFromAddress` → `legacyIdentityFromAddress` so nothing keeps the weak path as primary.
5. Wallets without `signMessage`: visible "degraded privacy" banner + legacy derivation, not a hard block.
6. Fix lying comments in `use-shielded-identity.ts` + README.

**Effort:** M · **Depends:** after R6, with R2 (backup key derives from identity). **Success:** unit test asserts v2 identity is NOT derivable from address alone; manual e2e — fresh profile → one popup → old notes still appear → new memo decrypts only with v2 key.

### R2 — Recovery bounded by RPC retention [CRITICAL]

> Superseded 2026-07: backup feature deleted; persisted note store + 7-day scan is the accepted recovery model.

**Root cause.** `scanner.ts:37` `LEDGER_LOOKBACK = 10_000` (~14h); RPC quietly returns 0 events past retention. `README.md:187` claims "No client-side backup needed" — false.

**Recommendation: promote the backup flow, do not build an indexer** (new always-on service = out of scope for single-dev testnet). `backup.ts`/`use-notes-backup.ts`/`backup.test.ts` already built + wired into `user-menu.tsx`. Gap is only that it's optional/invisible.

**Fix.**
1. Track `lastBackupAt`; persistent badge after deposit/borrow when notes post-date last backup.
2. In `scanner.ts`, flag when `startLedger` was clamped by lookback (line 111) so UI says "history older than ~14h needs backup restore" instead of showing partial inventory as complete.
3. `decodeNotesBackup` (`backup.ts:192`) on import tries v2 then legacy identity (R1 interaction).
4. Rewrite `README.md:187`.
5. Punt raising `LEDGER_LOOKBACK` — overshoot silently returns nothing; backup is the answer.

**Effort:** S–M · **Depends:** coordinate with R1; docs part ships immediately. **Success:** fresh browser + backup file + wallet restores a note older than the lookback window and it's spendable; badge shows after deposit; README corrected.

### R3 — Liquidation service is a trusted deanonymizing party [HIGH]

**Assessment: acceptable-with-disclosure, no code fix.** Dual-encryption to borrower + `liquidation_service_pk` is deliberate (Track A). Decentralizing the operator is the only removal path — not a single-dev testnet task.

**Fix (docs + one UI line).**
1. README trust-model paragraph (~line 195): operator decrypts every borrow position; privacy holds against outsiders, not the operator; FROST is the removal path, unscheduled. Fix line 48's Track B framing to name what was given up.
2. Borrow drawer review step: one sentence — "Position details are visible to the liquidation service operator."
3. **Adjacent flag:** `LIQUIDATION_SERVICE_SK` sits plaintext in `.env.local` (gitignored, never committed — verified). Note in README it decrypts all borrow memos, must never enter public-deploy CI secrets; rotate via `gen:service-key` if exposed.

**Effort:** S · **Depends:** none, batch with R15/R16. **Success:** disclosures exist; BRD R3 flips from "contradiction" to "disclosed limitation."

### R6 — No automated e2e harness [HIGH — do first]

**Root cause.** `contracts/scripts/e2e-borrow.ts` (563 lines) exercises the full pipeline but is hand-invoked only; CI runs lint/typecheck/unit/build — none touch pub-signal ordering, G2 encoding, or Merkle budgets (the last three hotfixes). Its header references `contracts/scripts/e2e-deposit.ts` which **does not exist** (verified) — the harness assumes pre-seeded notes.

**Fix.**
1. Self-provision: add a deposit leg (`--provision` flag or fold 4× deposit into `e2e-borrow.ts`) so a run needs only a funded deployer key. Deposit prover exists (`deposit-prover.ts`).
2. `"test:e2e": "bun contracts/scripts/e2e-borrow.ts"` in package.json.
3. New scheduled workflow (`.github/workflows/e2e-testnet.yml`), **not PR-blocking** (testnet RPC flakiness). `schedule` cron daily + `workflow_dispatch`. Deployer secret via Actions secrets + `stellar keys add`; friendbot-fund if dry.
4. Extend later with repay/liquidate legs.

**Effort:** M · **Depends:** none; everything touching provers/scanner/contract wants this first. **Success:** scheduled workflow green twice; a transposed pub-signal on a scratch branch turns it red.

### R7 — Oracle price commitment not cross-checked on-chain [HIGH]

**Root cause.** `lib.rs` verifies `oracle_epoch` freshness only (~lines 1217/1502). Proof binds `borrow_price_commit = Poseidon(oracle_price, salt)` with a *private* salt; contract stores the Reflector address (line 222) but **never calls it** (verified — no cross-contract price read). A prover can commit any price.

**Real fix is L and gated.** Make `oracle_price` a *public* signal in shielded-borrow, contract calls Reflector `lastprice`, require `|committed − live| ≤ tolerance_bps` + epoch match. Cost: circuit change → new `.zkey` → verifier-key regen → contract upgrade → prover/UI in lockstep. Privacy cost nil. Bundle with the trusted-setup ceremony at the mainnet gate (both regenerate `.zkey`s — pay once).

**Do now:**
1. README limitation bullet (contract comment `lib.rs:29` already admits it).
2. Cheap detection: `scan-underwater.ts` already decrypts bonds — add a check comparing committed `borrow_price` vs Reflector history for the epoch, flag divergence (~dozens of lines).

**Effort:** S now / L deferred · **Success:** README states limitation; `scan:underwater` flags a synthetic divergent bond.

### R8 — Client crypto supply chain [HIGH]

**Root cause.** Artifacts in `public/circuits-circom/shielded/*` fetched at prove time with no integrity check; `fetchArtefact` copy-pasted into six provers. `snarkjs` caret range (`^0.7.6`).

**Fix.**
1. Shared `features/shielded-pool/artifacts.ts` with one `fetchArtefact` computing SHA-256 vs a checked-in manifest (`artifact-manifest.json`), throw on mismatch. Replace all six copies (net-negative lines).
2. `scripts/gen-artifact-manifest.ts` + extend `check:bundle` to re-hash and diff (answers OQ-7).
3. Pin `snarkjs` exact. **Remove `circomlibjs`** — imported nowhere (verified; app uses its own `poseidon.ts`). `@noble/*` current, fine.
4. Skip SRI/CSP/artifact-signing — hash-pin gives the same guarantee for this threat model.

**Effort:** M · **Depends:** after R6 (harness validates the loader refactor). **Success:** flipping one byte of `borrow.wasm` throws manifest-mismatch and fails `check:bundle`; lockfile shows exact snarkjs; `circomlibjs` gone.

### R15 — README accrual self-contradiction [MEDIUM]

`README.md:41` (Track D shipped) vs `README.md:190-192` (Deferred). Code sides with shipped (`rate.rs`, extended repay circuit, fixture coverage). **Fix:** rewrite the Deferred bullet to name only what remains deferred — *collateral recovery on repay* (v1 burns collateral). One edit. **Success:** `rg -n "accrual" README.md` returns non-contradictory claims.

### R16 — Contract-ID ambiguity + stale comments [LOW, compounding]

README documents `CBJZP45H…4N7L`; `.env.local` runs `CATPLYD…52YX`. **Fix:**
1. `stellar contract invoke --id <each> -- list_markets` — the one with live state is canonical (likely the `.env.local` one).
2. Update README (4 occurrences) + `docs/deployment.md` + `.env.example`; add a "env is canonical" checklist line.
3. Delete stale mock-adapter comments in `types.ts:65,138` + retired `borrow-eligibility-circom` dir (OQ-1).
4. CLAUDE.md architecture refresh (done).

**Effort:** S · **Success:** `rg` for stale ID returns zero; `list_markets` against documented ID returns live markets; no mock refs in `types.ts`.

### R17 — Fixed-denomination notes block variable loan/collateral amounts [SHIPPED — Phase 1 deployed]

**Update (this session, after the design below was scoped): implemented
and deployed.** Path 1 ("reveal-sum") was built, with two corrections
made during implementation that the original scoping below did not
anticipate:

- The signal actually exposed is `total_collateral_amount` — the RAW,
  un-multiplied sum of the 4 collateral amounts — not
  `total_collateral_value` as originally sketched below.
  `total_collateral_value` is already multiplied by `oracle_price`, an
  unconstrained PRIVATE witness the prover fully controls; exposing
  that and multiplying by a real price again in Rust would compute
  `real_price * fake_oracle_price * real_collateral` — still fully
  attacker-steerable, the same exploit this signal exists to close,
  just relocated. `total_collateral_amount` has no price factor, so a
  prover cannot lie about it without breaking Merkle inclusion.
- The cap formula is NOT `min(flat_cap, dynamic_cap)`. That formula
  would silently defeat the feature: the old flat per-asset
  denomination would remain an unconditional ceiling on every loan,
  same as before. Shipped formula: use `dynamic_cap` as-is whenever
  Reflector has a live feed for both legs and the result is positive;
  fall back to the flat denomination ONLY when no feed is available
  (fail-closed to the old safe amount, not fail-open to unlimited).

Also closed as part of this work, not originally scoped below: a
field-element truncation bug (`fr_to_i128`/`fr_to_u128` read only the
low 128 bits of a 255-bit BLS12-381 field element with no check the
high bits are zero) that would have let a forged value wrap around
`2^128` and defeat the new cap — and every other amount-carrying
equality check in the contract — through modular wraparound. Fixed via
a new `fr_to_amount_checked()` used everywhere a field element becomes
a fund-moving or cap-deciding value (deposit/withdraw/borrow amounts,
the new `total_collateral_amount` signal, `withdraw_loan_shielded`'s
payout). `fr_to_i128` was deleted once unused rather than left in the
tree as a hazard.

Shipped: `contracts/circuits/shielded-borrow/src/borrow.circom` (new
public output), `contracts/borrow-pool/src/reflector.rs` (new — first
Rust Reflector client in this repo), `contracts/borrow-pool/src/lib.rs`
(relaxed equality checks to range checks across deposit/withdraw/
borrow, dynamic cap, new `total_deposit_value`/`total_borrow_value`
counters + public view fns), `contracts/borrow-pool/src/state.rs`,
`contracts/borrow-pool/src/notes.rs` (`decimals()`),
`contracts/borrow-pool/src/borrow_verifier.rs` (17th VK IC point).
Deployed in place via `upgrade` to the live testnet contract
(`CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ`, new wasm
hash `1bd9eb2a4e3ca7f2a06f3b0b9b28f2a8e520818b513ff558ccad51bace2b0e14`,
previous `fe7d0378666d97bd70eafa2cd9bf664a73e55cb245d48ea409a355b5f53d0033`
recorded for rollback). TS bindings, circuit artifacts, and the
artifact manifest were regenerated and `bun run check:artifacts` /
`lint` / `typecheck` / `test` all pass post-redeploy.

`repay_shielded` deliberately does NOT update the new
`total_deposit_value`/`total_borrow_value` counters — its public
signals carry no amount (loan/deposit amounts stay private witnesses
there), so those two counters will drift over time relative to real
value. Documented as a known limitation in `lib.rs`, not silently
ignored; out of this session's approved scope to fix (would need its
own circuit change).

Frontend UI wiring (deposit/borrow amount as real typed user input)
and the accounting-consumer updates (`market-history.ts`,
`market-stats.ts`, `derive-metrics.ts`, `scanner.ts`'s deposit branch)
are Phase 2/3 of the same plan — not yet done as of this update, gated
on the live-network verification checklist passing against the
redeployed contract.

**Original scoping below, kept for the design rationale (formula
details are superseded by the Update above):**

**Root cause.** Note amounts are fixed per-asset denominations (`DENOMINATION` in
`features/notes/note.ts`, mirrored in `contracts/borrow-pool/src/notes.rs`:
`XLM: 10_000_000`, `USDC`/`EURC: 5_000_000`). `deposit_shielded`,
`deposit_shielded_quad`, and `deposit_shielded_batch` each carry their own
inline `!= denomination` equality check (`lib.rs:420-424,511-513,654-656` —
three separate sites, not a shared helper). `borrow_shielded` caps at one
denomination via `> max_borrow` (`lib.rs:852-856`, already a ceiling, not an
equality — tolerant of smaller amounts already). `borrow.circom` never
computes or exposes a real collateral value on a public signal, so today's
solvency guard is entirely the flat contract-side cap (S3, `09471e9`).
Variable amounts need the circuit to surface collateral value somehow —
that's the open design question below.

**Two paths scoped this session, neither chosen or built:**

1. **Reveal-sum.** Promote the already-computed `total_collateral_value`
   (`borrow.circom`'s `partial_values[0..3]` sum) to a new public Groth16
   signal; contract reads a live Reflector price (no Rust Reflector client
   exists today — `state::reflector` stores an address but nothing ever
   calls it, confirmed via repo-wide grep) and computes a dynamic cap:
   `min(denomination(borrow_asset), real_price * total_collateral_value * max_ltv_bps/10000 * 9500/10000)`.
   Circuit diff is small — zero new constraints (the value is already
   computed, only its public/private declaration changes), ~6.7% on-chain
   verification cost increase (15→16 public signals; the pairing check,
   which dominates BLS12-381 Groth16 verification cost, is unaffected by
   public-input count). Still needs: a new `.zkey`/verifying key, the new
   Rust Reflector-client code, and a contract redeploy. **Tradeoff:** leaks
   total collateral value on-chain — a real new leak once amounts vary
   (today it's an implicit constant, so nothing new leaks). Comparable in
   kind to the loan-claim-amount leak already accepted at
   `withdraw_loan_shielded` (`lib.rs:983`, "accepted trade-off for MVP").
   Conflicts with `docs/PRD.md:71`'s current claim that the borrow proof
   works "without revealing amounts" — that line would need updating
   alongside the circuit change, not just this entry.
2. **Hide-everything (Pedersen-style homomorphic commitment), Zcash-style.**
   No new leak. Blocked, not just harder: every live circuit (all 8,
   confirmed via each `build/verification_key.json`'s `"curve": "bls12381"`)
   compiles against BLS12-381. circomlib's vendored Pedersen commitment
   (`node_modules/circomlib/circuits/pedersen.circom`) is built on Baby
   Jubjub, a curve embedded in BN254's scalar field — a different field
   than BLS12-381's `Fr`. No BLS12-381-native Pedersen/homomorphic-commitment
   template exists anywhere in this toolchain; building one is unproven R&D,
   not an integration task. Constraint-cost estimate if it existed: a
   fixed-base EC commitment runs roughly 1,000-2,500 constraints per
   instance (aggregate-only) against this circuit's current ~18-22K-constraint
   budget — a real but survivable +20-50% overhead, not the blocker. The
   curve mismatch is the blocker.

Not recommending one path over the other here — (1) is buildable in this
toolchain today at a known, bounded cost; (2) needs a cryptographic primitive
that doesn't exist yet for this curve. Revisit path 2 only if a BLS12-381-native
homomorphic scheme becomes available, or if real demand makes the (1)-style
leak unacceptable.

**Also touches (accounting blast radius, either path):** `total_deposit`/
`total_borrow` are pure note counters today (`+1`/`+4`/`-1` per event,
`lib.rs:458,772-775,920-928,1053-1056,1169-1177,1285-1319,1438-1465`) — would
need to become value sums. `features/markets/market-stats.ts` and
`derive-metrics.ts`'s `computeUtilization` read/consume those counters
directly (formula itself doesn't change — it's dimensionless — only the
input semantics do). `features/markets/market-history.ts`'s event-replay
(`undoDelta()`) applies hardcoded per-event-type deltas and would need the
real amount instead of a fixed unit. `features/notes/scanner.ts` already
reads explicit amounts for loan/withdraw notes but hardcodes
`DENOMINATION[asset]` for deposit notes (memos never carry an amount today —
needs a memo schema change). `borrow-prover.ts`'s `validateCollateralNotes`
hard-equality-checks `note.amount !== DENOMINATION[asset]` and would become
a sum/range check. `repay.circom` and `withdraw.circom` already support
variable amounts today — no circuit change needed there.

**Effort (original estimate):** Unscoped · **Status (original):** Deferred,
no timeline. Superseded — see the Update at the top of this entry:
Phase 1 (contract + circuit) is built and deployed; Phase 2/3
(accounting + frontend wiring) are the remaining work, gated on the
live-network verification checklist.

### R18 — Poseidon constant re-decoding blew the per-tx instruction budget [SHIPPED — fixed and deployed]

**Discovered while verifying R17's Phase 1f redeploy.** After that
upgrade, every Groth16-verifying entrypoint — including
`deposit_shielded` singleton, whose own verify path R17 never touched
— started failing simulation with `HostError: Error(Budget,
ExceededLimit)`. Seven parallel research agents initially converged on
"R17's WASM growth (68,538→74,839 bytes) pushed an already-thin margin
over budget," and a contract split (moving `reflector.rs` +
`dynamic_borrow_cap` into a separate `borrow-cap-helper` contract,
cross-called only from `borrow_shielded`) was designed and built on
that theory. The split shrank `borrow-pool` to 62,320 bytes — *below*
the pre-R17 baseline — but a deposit still failed identically on a
freshly deployed instance. A same-moment control redeploy of the
*original, pre-R17* wasm ALSO failed on the same call, which it had
passed hours earlier — directly falsifying the WASM-size theory (a
smaller binary than ever failed; unmodified old code that used to pass
also failed with no code change on that side).

**Actual root cause, found by direct measurement, not size or
crypto-primitive cost:** `contracts/borrow-pool/src/poseidon.rs`'s
`poseidon()` function decodes the T3 round-constant tables (`C_T3` +
`M_T3` + `P_T3` + `S_T3`, 498 `Fr` values) from raw bytes on **every
single call**, via `c_t3(env)`/`m_t3(env)`/`p_t3(env)`/`s_t3(env)`.
`merkle::append`'s `DEPTH=20` tree-insertion walk calls
`poseidon::hash_two_to_one` once per level — 20 calls, each redecoding
the exact same 498 constants from scratch. Measured directly via
`stellar contract invoke --build-only` → `stellar tx simulate` →
`stellar tx decode`, reading `resources.instructions` off the decoded
`SorobanTransactionData` (the technique this whole investigation
eventually converged on as the only reliable ground truth — Soroban
attaches no cost breakdown to a Budget-exceeded error on any RPC,
local or public, confirmed exhaustively): **one DEPTH=20 Merkle
insertion alone costs ~368.9M instructions — 92% of testnet's entire
400,000,000 `txMaxInstructions` budget** — dwarfing the ~50M for a
full Groth16 verify (3-signal deposit circuit) and ~1.5M for an
authorized token transfer. Soroban's own calibrated cost table
(`ContractCostParamsCpuInstructions` ledger config, read directly)
shows the individual field ops are cheap (`Bls12381FrMul` const=332,
`Bls12381FrAddSub` const=74) — the cost lives in the pure-WASM control
flow and per-call host-object overhead of decoding ~500 constants
from bytes 20 times over, not in the field arithmetic itself.

This bug pre-dates R17 entirely — `merkle::append` has redecoded these
constants on every call since the module was first written. R17
merely added enough incidental weight (a few hundred KB of binary
growth, one more storage write) to tip a call that was *already*
consuming 92%+ of the budget over the edge. A pre-existing code
comment in `lib.rs` ("four separate transfers plus the pairing check
would trip the 100M per-tx cap") shows the original author already
suspected this call was living dangerously close to some ceiling —
just misattributed to token transfers rather than Merkle hashing, and
under a stale assumption about the cap's actual value (100M vs.
testnet's real 400M).

**Fix:** `poseidon::Hash2Constants` — decode the T3 tables ONCE per
tree-walk and reuse across all 20 (or 21, for
`append_four_aligned`'s 4-leaf-aligned insert) levels, instead of once
per level. Same Poseidon math, same output, zero security change —
purely eliminates redundant decoding. Measured: 368.9M → 287.8M
instructions for the same 20-level walk (**-22%, -81.1M**). Applied to
`merkle::append`, `merkle::append_four_aligned`, and
`merkle::verify_inclusion` (dev/test utility, fixed for consistency).

**Verified end-to-end on testnet, both on temporary contracts and
against the live redeployed contract**
(`CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ`):
`deposit_shielded` singleton succeeded repeatedly (6+ real on-chain
transactions) where it had failed 100% of the time before the fix.
`deposit_shielded_quad` (a separate, larger 6-public-signal circuit)
still exceeds budget even after this fix — a known, disclosed
remaining limitation, not blocking since 4 singleton deposits cover
the same collateral-note requirement. `borrow_shielded` — the actual
R17 feature, including its cross-contract call to the new
`borrow-cap-helper` for the dynamic price-aware cap — was exercised
successfully end-to-end for the first time in this investigation
(real on-chain tx, `SUCCESS` status).

**Two more real bugs found and fixed as a direct consequence of R17's
event-schema change** (amount appended to `DEPOSIT_EVENT`/
`BORROW_EVENT`), surfaced only because this investigation finally
reached a live post-R17 borrow flow: `features/shielded-pool/
withdraw-tree.ts`'s `decodeDepositEvent` and `features/notes/
scanner.ts`'s `decodeIndexMemo`/`decodeBorrowSpentNullifiers` all
hardcoded exact event-array lengths (4/8) that R17's appended field
changed to 5/9, silently failing to decode every post-R17 deposit/
borrow event on the LIVE contract (misreported as "expired from RPC
retention" — a generic fallback message, not a real retention issue).
Relaxed to accept both old and new shapes. Also applied the R17-plan's
already-scoped Phase 3 item: `borrow-prover.ts`'s `computeBorrowAmount`
now applies the same 9500/10000 safety margin `dynamic_borrow_cap`
does, so client-computed borrow amounts don't get rejected by the
contract's own (correctly) more conservative cap.

**Shipped:** `contracts/borrow-pool/src/{poseidon.rs,merkle.rs}` (the
fix), `contracts/borrow-cap-helper/` (new, stateless helper contract —
`CB42XZGW4G6WJE5NVXFZKP5TFIE564JBHJ7COH6KHDNK6UIRP6KOBKHK` — holding
only `reflector.rs` + `dynamic_borrow_cap`'s body, cross-called from
`borrow_shielded` via a new `state::borrow_helper` address + admin-
gated `set_borrow_helper`), plus the removal of confirmed-dead legacy
code (the non-shielded transparent `borrow`/`repay`/`position`/
`positions_by_account` path and its `verifier.rs`, retired per
CLAUDE.md but still compiled into every build until now) as a
genuinely free size/complexity cut alongside the real fix. Deployed to
the live contract via `upgrade` (new wasm hash
`54fc5b2ed181574840abcb1b5bc615ff497d371fc76d35778349cfaa2e1d77d3`).
`features/shielded-pool/withdraw-tree.ts`, `features/notes/
scanner.ts`, `features/shielded-pool/borrow-prover.ts` (+ its test)
carry the three JS-side fixes.

**`deposit_shielded_quad` — initially reported as still over budget,
corrected after direct re-measurement.** A first post-fix test (via
`contracts/scripts/e2e-borrow.ts`) failed identically to before. Component-
level measurement of the exact same code paths (`probe_merkle21_cached`:
21 cached Poseidon(2) calls matching `append_four_aligned` exactly =
301,997,236 instructions; `probe_quad_verify`: the real 6-signal vk_x
loop + pairing = 61,705,188; a 4-event publish with realistic ~180-byte
memos = 1,462,657; an authorized token transfer = 1,468,499) summed to
~366.6M — comfortably under the 400M budget, contradicting the observed
failure. Direct re-test (3 fresh contract deploys, 3 real
`deposit_shielded_quad` calls with real proofs) then **passed cleanly
3/3**, on-chain `SUCCESS` each time. Conclusion: the earlier failure was
transient testnet-side resource-estimation variance at a genuinely tight
but real margin (~366.6M/400M, ~8% headroom) — not a residual code
defect. Quad was never touched by a second fix; it's fixed by the same
Hash2Constants change as everything else, just needed re-verification
after the fact rather than trusting one failed run. ~8% headroom is
real but not large — a future increase in quad's own logic (more
signals, deeper storage writes) could plausibly tip it again; if that
happens, the same instruction-measurement technique (`stellar contract
invoke --build-only` → `tx simulate` → `tx decode`, reading
`resources.instructions`) is the way to get a real number, not another
guess from binary size.

The contract-split-into-helper work, while it wasn't what fixed any of
the failing calls (none of them ever called Reflector), is kept
regardless: it's a real, verified size reduction (62,320B, below the
pre-R17 baseline) and establishes a clean pattern (stateless helper,
cross-called only when needed) for any future logic that doesn't
belong in every call's hot path.

### R19 — BORROW_EVENT didn't carry the collateral amount it consumed [SHIPPED]

Found while implementing R17 Phase 2 (`market-history.ts`'s backward
event-replay needs real amounts, not fixed note-count deltas).
`borrow_shielded` already computes `total_collateral_amount` (the
exact sum of the 4 spent collateral notes) and uses it to decrement
`state::total_deposit_value` on-chain — but never published that
number anywhere, so an off-chain replay of `BORROW_EVENT` history had
no way to reconstruct how much collateral value a given historical
borrow actually consumed. `declared_borrow_amount` (the loan side) was
already on the event from R17; only the collateral side was missing.

**Fix:** appended `total_collateral_amount` to `BORROW_EVENT`'s tuple
(now 10 elements: `index, root, leaf, memo, n0..n3, declared_borrow_amount,
total_collateral_amount`). Same leak class already accepted for
`declared_borrow_amount` — the value was already derivable from the
proof's public `total_collateral_amount` signal, this just makes it
convenient to replay off-chain. `features/notes/scanner.ts`'s
`decodeIndexMemo`/`decodeBorrowSpentNullifiers` length checks widened
to accept 10 alongside the existing 4/5/8/9. Verified end-to-end on a
temp contract: a real `borrow_shielded` call's event decoded with
`total_collateral_amount = 40,000,000` (4 × 10,000,000 XLM notes),
exactly matching what was actually spent. Deployed to the live
contract via `upgrade` (wasm hash
`1b2366fd097a3ef5e804dfe27d66ed7f0b2156b8e4a2d6b5dc34473781a93f5a`) —
no circuit or VK change, no TS bindings change (only an internal event
payload, not a function signature).

### R20 — Borrow amounts hidden on-chain; oracle_price becomes the real solvency guard [SHIPPED]

Directly resolves **S3** below (recorded as CRITICAL): the borrow circuit's
LTV/HF band was decorative because `oracle_price` was an unconstrained
private witness — a modified client could satisfy the band with any price,
so `borrow_shielded`'s real solvency bound was the contract-side flat/
dynamic cap, not the circuit.

User asked whether borrow/loan amounts could be hidden on-chain at all.
Investigation (not assumed — verified against a live decoded tx) found
deposit/withdraw amounts **can't** be meaningfully hidden: both call a real
SEP-41 SAC `token::transfer`, which unconditionally emits a public event
with the cleartext amount in the same transaction — hiding the ZK proof's
own amount signal buys zero privacy there. `borrow_shielded` is different:
it mints a shielded loan-tree note with no token transfer at all (the SAC
transfer happens later, at claim time), so its `total_collateral_amount`/
`borrow_amount` public signals were the only amount-revealing thing not
already shadowed by a transparent transfer log.

A Pedersen/homomorphic commitment alone cannot replace a cap check against
a *hidden* value — that needs a full range-proof system (Bulletproofs-class),
out of scope here. The real fix has to happen inside the Groth16 circuit
with ordinary private-witness arithmetic, which is what makes `oracle_price`
needing to be public (and contract-verified) unavoidable regardless of
whether a commitment scheme is added on top. The user chose to build both
together: the in-circuit fix (required) plus Jubjub-over-BLS12-381 Pedersen
commitments (additive, not a replacement — verified against `zkcrypto/jubjub`
v0.9.0, the same curve Zcash Sapling uses for its own value commitments, and
a *different* curve from circomlib's BN254-embedded "Baby Jubjub").

**Fix:**
- `borrow.circom`: `total_collateral_amount`/`borrow_amount` are now pure
  private witnesses (never public); `oracle_price` moved from private
  witness to public input — the existing `GreaterEqThan`/`LessEqThan` LTV
  band is unchanged in structure but is now a real check instead of
  decorative. Two new `PedersenCommit` outputs (`collateral_pedersen_{u,v}`,
  `loan_pedersen_{u,v}`) via a new `jubjub_pedersen.circom` (plain
  double-and-add scalar multiplication, not circomlib's windowed
  optimization — simpler to audit, and twisted-Edwards completeness means
  no exceptional-point workarounds are needed). New signal count: 19
  public signals (was 16), `ic_len = 20`.
- `contracts/borrow-pool/src/jubjub.rs` (new): hand-rolled Jubjub point
  addition using `Env::crypto().bls12_381()`'s `fr_add`/`fr_sub`/`fr_mul`/
  `fr_inv` — no non-native field arithmetic needed, since Jubjub's base
  field is *literally* BLS12-381's scalar field. Folds each borrow's
  Pedersen commitments into new per-asset `RunningCollateralCommit`/
  `RunningLoanCommit` counters (`state.rs`) via EC addition; the contract
  never decodes an individual amount from them. No concrete consumer of
  the aggregate exists yet — built anyway per explicit user request, as a
  door left open for a future audit tool.
- `borrow_shielded` cross-checks the proof's public `oracle_price` against
  a live Reflector read (new `BorrowCapHelper::price_ratio` entrypoint,
  raw ratio with no LTV/cap math applied) within `ORACLE_PRICE_TOLERANCE_
  BPS` (200 bps) and fails closed (`Error::StaleOracle`) on no feed or an
  out-of-band price. The old `dynamic_borrow_cap` call and its flat-
  denomination fallback are removed entirely — there is nothing left to
  fall back to once `borrow_amount` is a private witness the circuit alone
  checks against a price. `total_deposit_value`/`total_borrow_value` stop
  adjusting on borrow (same accepted-limitation category `repay_shielded`
  already carries — no honest clear-text amount left to adjust by).
  `dynamic_borrow_cap` (lib.rs local wrapper) and `borrow-cap-helper`'s own
  `dynamic_borrow_cap` entrypoint are left in place, unused, rather than
  deleted — a separate, lower-priority cleanup.
- `BORROW_EVENT` drops `total_collateral_amount`/`declared_borrow_amount`
  (no longer exist) and publishes the four Pedersen coordinates instead.
  `market-history.ts`/`scanner.ts` updated for the new 12-element body
  shape; amount/collateralAmount decode to `null` for R20 events
  permanently (not a gap — there is no public amount to decode), falling
  back to the existing `DENOMINATION` approximation already wired for
  pre-R17/repay events.
- Verification, in order: (1) cross-checked the Jubjub curve constants,
  base points, and both the circom gadget and the Rust port bit-for-bit
  against `zkcrypto/jubjub` v0.9.0 reference test vectors
  (`contracts/borrow-pool/tests/jubjub_fixtures.txt`) — all three agreed
  exactly; (2) deployed a throwaway probe contract exercising `jubjub.rs`'s
  `jubjub_add` on testnet, matched the fixture exactly, then deleted the
  probe; (3) compiled the real `borrow.circom` (38,436 non-linear
  constraints, comfortably under `pot17`'s 2^17 capacity — no bigger
  trusted setup needed), ran a full local Groth16 setup/contribute/export
  cycle, and generated + verified a complete proof for a realistic 4-note
  borrow scenario built entirely in-process (no chain needed) — `snarkjs
  groth16 verify` returned OK against the new verification key.
- **Temp-contract round trip caught a real regression before it reached
  the live contract**: a real `deposit_shielded_quad` + `borrow_shielded`
  call against a fresh temp deploy exceeded the network's per-tx
  instruction ceiling (402.2M vs a 400M cap) — the 3 extra public
  signals (16 → 19) each added a full G1 scalar mult to
  `borrow_verifier.rs`'s per-signal `g1_mul`+`g1_add` loop, and the old
  16-signal circuit was already close to the ceiling (same class as
  R18). **Fix:** replaced the loop with a single batched `g1_msm`
  (multi-scalar-multiplication) host call — same math, one host call
  instead of 19. Retested on the temp contract post-fix: full round trip
  passed, and `running_collateral_commit`/`running_loan_commit` read
  back as non-identity points, confirming the on-chain EC folding
  actually ran. Also confirmed live: `market-history.ts`'s
  `decodeEventAmounts` correctly falls back to `null`/`null` against the
  real 12-element `BORROW_EVENT` body from this run.
- Deployed to the live contract (`CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ`)
  via `upgrade` (wasm hash
  `72ab2307ff591d32b80f98cfc4e9f63f976beea8ecff9318ed2d7d4e0fd9db08`),
  paired with a freshly redeployed `borrow-cap-helper` instance
  (`CAAYY623FT5JUVBQNW3BPTHZWJ2Q2KJUPLIJTDZJZDYYHZRC25GW5JYP`, exposing
  the new `price_ratio` entrypoint) wired via `set_borrow_helper`. Prior
  wasm hashes recorded for rollback: pool
  `1b2366fd097a3ef5e804dfe27d66ed7f0b2156b8e4a2d6b5dc34473781a93f5a`,
  helper `fe609f9e80b6cb5b880d82c68b0a74a0e58a0c0bc0404b50e3704ee995b930ff`.
  Storage confirmed intact post-upgrade (`risk_params` unchanged).
  `lint`/`typecheck`/`test` (271 passing)/`build`/`check:bundle` all
  green before deploy.

### R21 — R20's LTV/HF checks were dimensionally broken, ~1e14x too loose [SHIPPED]

Found immediately after shipping R20, before starting unrelated work —
re-reading `borrow.circom`'s pre-existing (not introduced by R20) LTV/HF
comparators while investigating liquidation's known dimensional bug (S4)
surfaced the same defect class one file over.

`oracle_price` carries `PRICE_RATIO_SCALE` (1e14, matches
`features/markets/prices.ts`). `total_collateral_value = Σ amount ×
oracle_price` inherits that scale; `borrow_amount` never did. The
comparators compared them directly:
```
lhs = total_collateral_value * 10000        // scaled by 1e14
rhs = borrow_amount * hf_min_bps            // NOT scaled
```
— off by ~1e14x too loose in both directions (HF floor and max-LTV
ceiling). Concrete number at a real testnet price (~1.8e13): 1 stroop of
collateral would satisfy max-LTV against a borrow of up to ~6.25e13 raw
units. R20 made this check's price input honest (verified against live
Reflector) but didn't touch the formula itself, and R20 also **removed**
the old contract-side `dynamic_borrow_cap` (which WAS scale-correct) on
the premise that the in-circuit check was now the real guard — so for
the few hours between R20 and this fix, an attacker bypassing the
client's own `computeBorrowAmount` helper (which was always scale-correct)
could have opened a materially under-collateralized position with a
valid proof. No such transaction was observed on the live contract in
that window (testnet, single active client).

**Fix:** both comparators now scale `borrow_amount`'s side by the same
`PRICE_SCALE` constant (1e14) instead of dividing the collateral side —
equivalent, and division isn't native circom arithmetic. Also widened
`GreaterEqThan`/`LessEqThan` from 128 to 160 bits: `borrow_amount`
(~60 bits) × `hf_min_bps`/`max_ltv_bps` (circuit-unbounded, u32 ⇒ up to
32 bits) × `PRICE_SCALE` (~47 bits) can reach ~139 bits in the
admin-set-risk-params worst case — comfortably over 128, which would
have silently miscompared (circomlib's comparator trick is only sound
when both operands fit the declared width) even after the scale fix.
Deployed values (`hf_min_bps=12500`, `max_ltv_bps=6250`) are nowhere
near that bound, but the circuit itself doesn't constrain the bps
values' bit-width, so the wider comparator is not speculative margin —
it closes an actually-reachable-by-admin-misconfiguration unsoundness.

**Verification:** rebuilt witness for the same realistic scenario R20
used (40,000,000 raw collateral, 1e14 parity price) — legitimate
borrow (5,000,000, well under the corrected ~25,000,000 cap) still
produces a valid witness; an oversized borrow (30,000,000, over the
cap) now correctly fails witness generation (`Assert Failed`, the
`ltvCheck` constraint) — confirmed it did NOT fail pre-fix by
construction (this is exactly the bug). Full new trusted setup +
Groth16 prove/verify cycle passed. Retested the full deposit→borrow
round trip on the temp contract with the corrected wasm — still
succeeds for an honest client. Deployed to the live contract via
`upgrade` (wasm hash
`c19b28f2135c66ad175a25b991bf0ca2747363d42826f995b1ce83e657ac6317`);
`borrow-cap-helper` untouched (this fix is entirely inside
`borrow.circom`/`borrow_verifier.rs`'s VK). Storage confirmed intact
post-upgrade. `lint`/`typecheck`/`test` (271 passing) all green.

### R22 — Liquidation v3: fixed the dimensional bug, threshold_bps convention, and missing live-price check [SHIPPED]

Resolves **S4** below. Liquidation triggering has been inert since
`09471e9` — the v1/v2 underwater inequality is dimensionally broken
(`collateral_notional` carries `PRICE_RATIO_SCALE`, 1e14, from being
`raw_collateral × borrow_price` at open; `loan_amount` doesn't), so no
proof could ever satisfy it. Three independent bugs, found by direct
code reading, ship together — fixing only the dimensional one would
still let a prover fabricate `current_price` to force `underwater` on a
healthy position, the exact fail-open regression `09471e9` avoided:

1. **Missing `PRICE_SCALE` factor** — same bug class as R21, duplicated
   in five places: both `contracts/circuits/shielded-liquidate{,-v2}/src/liquidate.circom`,
   both provers' client-side pre-flight guards, and
   `contracts/scripts/scan-underwater.ts`'s `checkUnderwater`.
2. **`threshold_bps` convention was backwards from the UI.**
   `components/organisms/loan-health.ts` (what renders the "at risk"
   badge) treats it as a max-LTV ceiling on loan/collateral; both
   circuits treated it as a floor on collateral/loan — the opposite
   relationship. Circuits now match the UI's convention (which was
   always correct).
3. **No contract-side live-price cross-check** — `liquidate_shielded`/
   `liquidate_shielded_v2` only checked `current_price != 0`, the same
   gap R20 closed for `borrow_shielded`'s `oracle_price`. A prover could
   supply any non-zero price and the underwater check would evaluate
   against a fabricated number.

**Fix:**
- Both circuits: underwater when `collateral_now * threshold_bps <
  loan_amount * 10000`, matching `loan-health.ts` exactly, where
  `collateral_now` descales `collateral_notional` back through
  `current_price / (borrow_price * PRICE_SCALE)`.
- **A real bug surfaced mid-implementation, corrected before shipping:**
  the first version computed `collateral_now` via a witness-supplied
  field division (`<--` + `===`, the same pattern
  `jubjub_pedersen.circom`'s `PedersenCommit` uses for curve-point
  arithmetic). That pattern is only sound when the division is *exact* —
  circom's `/` is field-inverse multiplication, not integer floor
  division, so for any non-exact quotient (i.e. any real price ratio)
  it produces a ~253-bit field-inverse artifact instead of the intended
  small integer, and `Num2Bits` fails for every real input. Caught by
  testing against real testnet data (not just contrived synthetic
  cases) — the synthetic unit tests alone had passed. **Fixed** by
  cross-multiplying instead — no division anywhere:
  `collateral_notional * current_price * threshold_bps < loan_amount *
  10000 * borrow_price * PRICE_SCALE`. Comparator widened to
  `LessThan(200)` — real proof data lands around ~126 bits; generous
  headroom over that, not the field's ~253-bit ceiling, same
  "comfortably safe for realistic values, contract-level trust for the
  rest" judgment call R21 used, given `threshold_bps` is circuit-
  unconstrained u32 and `current_price`/`collateral_notional` aren't
  range-checked in-circuit (soundness against an absurd value comes
  from the contract's live-price cross-check and `fr_to_amount_checked`,
  not an in-circuit bound).
- `lib.rs`: new shared `verify_live_price` helper (extracted from R20's
  inline `borrow_shielded` block, reused there too) — both liquidate
  functions now cross-check `current_price` against a live Reflector
  read via the existing `live_oracle_price`/`BorrowCapHelper::price_ratio`
  (no helper redeploy needed) within `ORACLE_PRICE_TOLERANCE_BPS`,
  failing closed with `Error::StaleOracle`. Replaced the old
  `fr_to_u128`-based zero-check with `fr_to_amount_checked` (avoids a
  low-128-bit-truncation false-positive edge case on the zero guard).
- New `features/shielded-pool/liquidate-math.ts` — one shared
  `isUnderwater`/`collateralNow` implementation, imported by both
  provers and `scan-underwater.ts` instead of five independently-
  maintained copies of the same formula, which is the direct reason
  this bug survived multiple earlier fix opportunities.
- **Separately discovered and fixed while testing on real data**: both
  liquidate provers never set snarkjs's `singleThread` proverOption, so
  `groth16.fullProve` crashes under Bun (the multithreaded prover
  breaks on Web Worker message dispatch) — the same issue
  `borrow-prover.ts` already works around. This silently broke
  `scan-underwater.ts`'s `--trigger` flow (a Bun script) for as long as
  it's existed; not caught until this fix was tested against a real
  on-chain proof generation rather than only synthetic witnesses.
- New `features/shielded-pool/liquidate-math.test.ts`: known-good/
  known-bad cases plus an exact cross-check against `loan-health.ts`'s
  `loanHealth()` at every boundary case in its own existing fixture —
  closes REMEDIATION's own "no fixture at any level covers liquidation"
  gap for the formula itself.
- **Verification**: synthetic witness tests (underwater passes, healthy
  fails) for both circuits before AND after the division→cross-multiply
  fix (the "before" round is what caught the division bug); full local
  Groth16 prove/verify for both; a **real on-chain test** — opened a
  loan on a temp contract at the actual ~59.37% LTV `computeBorrowAmount`
  produces, temporarily lowered `liquidation_threshold_bps` below that
  (genuinely underwater at the real current price, no fabricated data),
  decrypted the borrower's own memo for the bond opening, generated a
  real `liquidate_shielded_v2` proof against a live Reflector price, and
  it succeeded on-chain; then restored the threshold and confirmed the
  now-healthy position's proof generation correctly refuses. Deployed to
  the live contract via `upgrade` (wasm hash
  `abc26f23641f42dd0d27cf0505e7bb2df87bc207a9b1b3ea3f3e5ce9a95c4717`);
  `borrow-cap-helper` untouched. Storage confirmed intact post-upgrade.
  `lint`/`typecheck`/`test` (278 passing)/`build`/`check:bundle` all
  green.

### Small items (slot into sequence)

- **Zero Rust contract tests** — blocked on soroban-sdk 23. One README line stating the block + stopgap (TS fixtures + R6 e2e). Re-check next sdk release.
- **`quote.ts` untested** — add `quote.test.ts` (LTV/HF/liquidation-price edges: zero collateral, max-LTV boundary, denomination-granularity rounding). Batch with R8 PR.
- **`shielded-deposit-quad` status** — circuit + verifier (`lib.rs:497`) + prover + artifacts all exist but nothing wires it. Decision, not build: add a README roadmap row ("experimental, unwired"). Resolves OQ-4.

---

## Part 3 — Recommended sequence

| # | Item | Effort | Why here |
|---|------|--------|----------|
| 1 | **R16** canonical ID + stale comments + CLAUDE.md | S | Unblocks R6 CI config; ends "which contract is real" tax |
| 2 | **R15 + R3 + R7-stopgap + deposit-quad row** (one docs PR) | S | Zero code risk; converts three "code contradicts docs" findings into disclosed limitations in an afternoon |
| 3 | **R6** e2e harness: deposit leg + scheduled workflow | M | The safety net; items 4–5 rethread prover/scanner and need it first |
| 4 | **R8** hash-pinned loader + snarkjs pin + drop circomlibjs + `quote.test.ts` | M | Mechanical, verified by the new harness; dedups six `fetchArtefact` copies |
| 5 | **R1** signature identity + cached secret + legacy fallback | M | Critical crypto fix, after the harness (rethreads identity through scanner/memo/backup — the regression class the harness catches) |
| 6 | **R2** backup promotion: badge + truncation flag + dual-identity import | S–M | Pairs with R1 (backup key changes with identity) |
| 7 | R7 real fix, Rust tests | — | Deferred: R7-real bundles with the ceremony at the mainnet gate; Rust tests wait on soroban-sdk |

---

## Part 4 — NOT NOW / gated

| Item | Risk/OQ | Gate that unblocks it |
|---|---|---|
| Trusted-setup ceremony | R5 | Mainnet go decision |
| Third-party audit (circuits + contract) | R6-audit, R14 | Mainnet go + budget |
| Compliance/legal position | R11, OQ-8 | Mainnet *exploration* decision — fires **first** among gated items (it's an input to the go decision) |
| Admin multisig/governance | R12 | Mainnet go decision |
| On-chain oracle commitment cross-check | R7-real | Mainnet gate (bundle with ceremony — shared `.zkey` regen) |
| Oracle fallback / second source | R13 | Mainnet, or Reflector incident |
| FROST / decentralized liquidation service | R3-removal | Dropped; revisit only if a mainnet product decision demands it — handled by disclosure until then |
| Anonymity-set growth | R4, OQ-1 | Real users — demand question, not engineering. Do nothing until OQ-1 has a signal |
| Scanner DoS hardening | R10 | Real adversarial traffic |
| Rust contract unit tests | R6/gap 1 | soroban-sdk 23 release — check quarterly |
| snarkjs supply-chain audit (deep) | R8-deep | Mainnet go (pinning ships in M2) |
| v2 repay circuit (collateral recovery) | PRD P1 | After M3 — feature work, through the harness |

---

## Hard sequencing constraints

1. **Canonical contract ID (M1) → e2e harness (M2).** Can't test an ambiguous target.
2. **E2e harness (M2) → any circuit/crypto change (M3, v2 repay).** Three hotfixes were in its catch class.
3. **R1 fix (M3) → any unqualified privacy claim.** Docs carry the caveat until then.
4. **OQ-2/OQ-3 decisions → their M3 implementations.** Both free; decide now so M3 doesn't stall.
5. **Legal position (R11) → mainnet go → everything in M4.** Legal is the first gated item, not the last.
6. **Single dev: milestones strictly serial.** If cutting, cut from the bottom of M2 (gaps 6–8 already cut) and the optional benchmark — never the harness, never R1.

---

## Part 5 — Superseded notes (append-only)

This register is a historical record; the sections above are preserved as
written on 2026-07-13. Everything below records where the code has since moved
past them. **Do not read Parts 1–4 without this section.**

### S1 — Contract ID: R16's canonical answer is superseded

R16 (§Part 2) resolves an ambiguity between `CBJZP45H…4N7L` and
`CATPLYD…52YX`. **Both are now retired**, along with every other prior
deployment. The canonical contract is
`CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ`, deployed fresh in
commit `09471e9` and declared in `.env.example`,
`features/protocol/bindings/borrow-pool.ts`, `contracts/scripts/*`,
`goldsky/stellar-shield-events.yaml`, and `deploy/*.env.example`.

R16's "in-place upgrade is the required deployment mode" premise no longer
holds unconditionally: two breaking changes (`ba81702` nullifier namespacing,
`09471e9` unit domain) forced fresh deploys that stranded pool state.

### S2 — Unit domain: raw stroops, not whole units (`09471e9`)

A class of defect the register never named. Note amounts, denominations,
circuit signals, and `token::transfer` arguments are all **raw token units**
(stroops, 7 decimals). Docs and circuit comments claiming "whole units" caused
a borrow to request 427M USDC and fail with `Error(Contract,#10)`.
Denominations were also raised from dust: `XLM: 10_000_000` (1 XLM),
`USDC`/`EURC: 5_000_000` (0.5), matched in `features/notes/note.ts` and
`contracts/borrow-pool/src/notes.rs`.

Stale "whole units" comments still survive in code and should be corrected at
the next touch: `contracts/borrow-pool/src/lib.rs:467`,
`contracts/borrow-pool/src/deposit_verifier.rs:5`,
`contracts/circuits/shielded-deposit/src/deposit.circom:13`, and the generated
`features/protocol/bindings/borrow-pool.ts:475`.

### S3 — Solvency moved from circuit to contract (`09471e9`) [RESOLVED by R20, SHIPPED]

The register treats the borrow circuit's LTV/HF check as a working control and
scopes R7 to the *oracle commitment*. That understates it: because
`oracle_price` is an **unconstrained private witness**
(`contracts/circuits/shielded-borrow/src/borrow.circom:36-42`), the circuit's
LTV band never bound anything — a modified client could mint any loan.

Solvency now lives where it can bind: `borrow_shielded` and
`withdraw_loan_shielded` reject `borrow_amount > denomination(asset)`
(`contracts/borrow-pool/src/lib.rs`). The cap is also what makes repay possible
at all — `repay.circom` burns exactly one deposit note, so a larger loan was
permanently unrepayable. Total collateral is public regardless (4 notes × fixed
denomination), so the clear-text cap costs no privacy.

Consequence for R7: making the circuit's LTV real requires binding the price,
which is the same `.zkey` regeneration as the oracle cross-check. The two
should be treated as one work item at the ceremony gate.

**Update (R20):** implemented. `oracle_price` is now a public signal
`borrow_shielded` cross-checks against a live Reflector read; the circuit's
LTV/HF band is the real solvency guard again. See R20 above for the full
design and its own pending-upgrade caveat.

### S4 — Liquidation triggering is inert; was previously fail-OPEN (`09471e9`) [RESOLVED by R22]

The register assumes Track A/L liquidation works. It does not.

Before `09471e9`, both call sites fetched the **loan** asset's USD price and
compared it against a collateral-denominated bond. Every position tested as
underwater — liquidation was **fail-OPEN**.

It now **fails closed**, which is safe but not working. The v1/v2 underwater
inequality compares `loan_amount · threshold_bps · borrow_price` against
`collateral_notional · current_price · 10000`, but `collateral_notional`
carries the borrow circuit's `1e14` price scale that the loan side does not.
The comparison is dimensionally mismatched, `GreaterThan` never asserts, and
witness generation fails for every position at any price. Both call sites also
skip when Reflector has no feed. See the `ponytail:` comments in
`features/shielded-pool/use-liquidate.ts` and
`contracts/scripts/scan-underwater.ts`.

**Update (R22):** implemented. Both circuits now cross-multiply instead of
comparing dimensionally-mismatched values, `threshold_bps`'s convention
matches `loan-health.ts`, and the contract cross-checks `current_price`
against a live Reflector read. A real forced-underwater liquidation
succeeded on-chain against a live price. See R22 above for the full
writeup, including a real division-vs-cross-multiplication bug caught
mid-implementation. `features/shielded-pool/liquidate-math.test.ts` is
the fixture this section originally called for.

### S5 — Claim and repay are mutually exclusive

Not previously recorded. `withdraw_loan_shielded` (claim) and `repay_shielded`
both spend `Poseidon(sk, loan_index)` into the same `loan_nullifier_used` set.
Whichever runs first closes the loan; the other returns `ProofReplayed`. There
is no claim-then-repay lifecycle. Collateral stays burned either way — v2 repay
(collateral recovery) remains the deferred item it was in Part 4.

### S6 — Cleanups since the plan

- Stale mock-adapter *comments* in `features/protocol/types.ts` (R16 step 3):
  **done**. The unused `ProtocolAdapter` type (`types.ts:112`) and the
  `circomlib` dependency (`package.json:32`) remain.
- Retired `borrow-eligibility-circom` dir (R16 step 3, OQ-1): **still present**.
- Test suite: 27 files / 197 tests (`bun run test`), up from the 23/170 quoted
  in PRD §7 at plan time.
- Note recovery: the scanner now pages the **full RPC retention window**
  (`rpc-events.ts`, `oldestLedger + 10` → `latestLedger`) and merges into a
  **persisted, tombstoning** note store, optionally merged with indexed events
  via `/api/events` (Goldsky → Neon). R2's window-bounded framing still holds
  for the underlying limit; the mitigation is stronger than recorded.
