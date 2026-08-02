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

### S3 — Solvency moved from circuit to contract (`09471e9`) [CRITICAL]

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

### S4 — Liquidation triggering is inert; was previously fail-OPEN (`09471e9`) [CRITICAL]

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

**Unblock:** a v3 liquidate circuit with an explicit divisor plus a
contract-read price. **Gate it on a test first** — no fixture at any level
covers liquidation proving, which is why the mechanism flipped from fail-open
to fail-closed unnoticed. A fixture asserting "underwater ⇒ proof succeeds;
healthy ⇒ proof fails" belongs ahead of the v3 build, and belongs in M2's
safety-net bucket, not M4.

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
