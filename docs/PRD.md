# Product Requirements Document (PRD)

## Stellar Shield — Borrow in the Open, Keep Your Positions in the Dark

**Version:** 1.1 | **Date:** 2026-07-13 | **Status:** Remediation M1–M3 applied
**Companion docs:** [BRD.md](./BRD.md) (business context), [REMEDIATION.md](./REMEDIATION.md) (engineering risk register R1–R16)

**Legend:** `[IMPLEMENTED]` = live in code, testnet-real · `[PLANNED]` = roadmap
· `[DROPPED]` = explicitly abandoned · `[GAP]` = claim the code once contradicted
(v1.1: the two originally-flagged gaps are now resolved — see below).

Every requirement was fact-checked against source. The two gaps v1.0 flagged
are addressed: identity is now signature-derived (FR-N1, R1 shipped); and the
composition root is `features/shielded-pool/shielded-pool-provider.tsx` with no
`AdapterProvider`/mock adapter (FR-P3), with the stale mock comments in
`features/protocol/types.ts` still flagged for deletion.

---

## 1. Product Overview

Stellar Shield is a Zcash-style shielded lending pool on Stellar with a Next.js
16 dashboard. Users deposit fixed-denomination notes into per-asset commitment
trees (Merkle depth 20; deposit + loan trees), borrow against exactly 4
collateral notes with a Groth16-verified LTV check against a committed
Reflector price, claim the loan to their wallet, and repay (with interest
accrual) by burning a same-asset deposit note. Nullifiers prevent double-spend;
encrypted memos (ChaCha20-Poly1305 over X25519 ECDH) let a browser rebuild the
note inventory from public chain events **within the RPC retention window**
(see NFR-R1).

- **Canonical testnet contract:** `CBLTPN2JCUHYH35OFGAYQ3NJDJC66IMFPHLOBT6PI2XKNVKPNH4FS6I4`
  (declared across README/.env/CLI; R16 resolved — an earlier `CBJZP45H…`
  deployment is retired).
- **Registered markets:** USDC/XLM, XLM/USDC, EURC/USDC, USDC/EURC, EURC/XLM, XLM/EURC.

## 2. User Personas

1. **Priya, depositor** — parks testnet XLM/USDC in the shielded pool, later
   withdraws. Wants deposit and withdrawal unlinkable (identity now
   signature-derived; residual limit is the ~0 anonymity set — REMEDIATION R4).
2. **Boris, borrower** — deposits ≥4 collateral notes, borrows, claims loan,
   repays with interest. Wants loan size and liquidation level private.
3. **Lena, liquidation operator** — runs `bun run scan:underwater` (optionally
   `--trigger`) for the bounty. Never holds borrower *spending* keys (v2
   circuit), but **does** decrypt all borrowers' position openings (REMEDIATION R3).
4. **Devon, developer/admin** — deploys/upgrades contract, sets params,
   registers markets, maintains circuits.

## 3. User Stories

### P0 — core lifecycle `[IMPLEMENTED]`

- Connect Freighter on testnet; derive a shielded identity (from a signature)
  so only I can discover my notes.
- Deposit a fixed-denomination note; contract pulls tokens, appends the
  commitment, emits an encrypted memo.
- With ≥4 unspent collateral notes of one asset, generate a Groth16 borrow
  proof in-browser (~15–30s) proving LTV ≤ `max_ltv_bps` against a committed
  oracle price, without revealing amounts.
- Claim the loan (`withdraw_loan_shielded`) to my wallet.
- Repay by burning a same-asset deposit note covering principal × accrued
  interest index; both nullifiers burn.
- Withdraw any deposit note back to my wallet at the fixed denomination.
- On a fresh browser, recover my note inventory by scanning public events
  (window-bounded — NFR-R1).

### P0 — solvency `[IMPLEMENTED]`

- Self-liquidate an underwater position (v1 circuit + bond commitments).
- As an operator, liquidate underwater positions without borrower spending
  keys via memo openings + v2 circuit (`liquidate_shielded_v2`); v1 fallback
  for grandfathered bonds.
- Enumerate live bonds (watchlist), triage with decrypted openings
  (authenticated mode), auto-trigger liquidations (`--trigger` +
  `LIQUIDATOR_SECRET` + `LIQUIDATION_SERVICE_SK`).

### P1 — quality of life

- Live health factors on loan notes (`LoanHealthBadge`, cached prices). `[IMPLEMENTED]`
- Privacy mode: addresses, proof IDs, hashes, balances masked via `PrivateValue`. `[IMPLEMENTED]`
- Positions and activity derived from chain events. `[IMPLEMENTED]`
- Export/import encrypted notes backup. `[REMOVED — 2026-07]` — testnet
  accepts post-retention note loss; persisted local store + event scan is
  the recovery model.
- Repay returns collateral notes to the deposit tree. `[PLANNED — v2 repay circuit; v1 burns collateral]`
- Multi-note deposit in one proof. `[STATUS UNCLEAR — `shielded-deposit-quad`
  circuit + `deposit-quad-prover.ts` exist but are in no roadmap track; REMEDIATION OQ-4]`

### P2 — future

- WalletConnect. `[SCAFFOLDING ONLY]`
- On-chain oracle price-commitment cross-check. `[PLANNED — blocked on attestation channel]`
- Signature-based shielded identity derivation. `[IMPLEMENTED — R1 shipped]`
- FROST/threshold decryption for the liquidation service. `[DROPPED]`

## 4. Functional Requirements

### 4.1 Markets (`features/markets/`) `[IMPLEMENTED]`

- **FR-M1:** List markets registered on-chain (`use-registered-markets`,
  `chain-markets.ts` → contract `list_markets()`).
- **FR-M2:** Prices exclusively via `features/markets/prices.ts` (Reflector
  SEP-40 through Soroban simulate) + `price-cache.ts` + `use-asset-prices`.
- **FR-M3:** Market stats incl. pool totals from `total_deposit`/`total_borrow`
  views (`market-stats.ts`).

### 4.2 Wallet (`features/wallet/`) `[IMPLEMENTED]`

- **FR-W1:** Freighter connect/disconnect with testnet validation
  (`network.ts` — tested).
- **FR-W2:** Balances displayed privacy-masked.
- **FR-W3:** WalletConnect connector scaffolding, unsupported flow. `[P2]`

### 4.3 Shielded identity & notes (`features/notes/`) `[IMPLEMENTED]`

- **FR-N1 `[IMPLEMENTED — R1 fixed]`:** X25519 identity derived from a
  Freighter `signMessage` signature over a canonical message (a secret input),
  `use-shielded-identity.ts`. Signed once per browser profile; the 32-byte seed
  is cached in localStorage so the popup does not recur. The old address-derived
  scheme (`legacyIdentityFromAddress`) is retained only as a decrypt/spend
  fallback for pre-migration notes; new notes never mint under it.
- **FR-N2:** `scanner.ts` is the sole inventory builder: `deposit`/`borrow`
  events mint notes; `withdraw`/`repay`/`liquidate` events mark nullifiers
  spent; each memo trial-decrypted against the current identity plus supplied
  legacy identities (each note materializes with the `sk` of whichever identity
  decrypted it). Lookback: 10,000 ledgers (NFR-R1).
- **FR-N3:** In-memory note store replaced wholesale per scan; surfaced via
  `useNotes()`.
- **FR-N4:** Poseidon commitments + Merkle paths client-side (`poseidon.ts`,
  `merkle.ts` — tested against fixtures shared with the contract).
- **FR-N5:** Removed: encrypted backup export/import (testnet accepts
  post-retention loss). Recovery is the persisted local note store plus the
  ~7-day chain-event scan; reintroduction path is an indexer, gated on
  mainnet.

### 4.4 Shielded pool operations (`features/shielded-pool/`) `[IMPLEMENTED]`

- **FR-S1:** Hooks `useDeposit`, `useBorrow`, `useWithdraw`, `useRepay`,
  `useLiquidate`; each pairs a snarkjs prover wrapper (`*-prover.ts`) with
  generated TS bindings (`features/protocol/bindings`), signed via Freighter.
  All provers load artifacts through one SHA-256-pinned loader
  (`artifacts.ts` + committed `artifact-manifest.json`) that refuses to prove
  on a hash mismatch (R8).
- **FR-S2:** Borrow consumes exactly 4 collateral nullifiers
  (`COLLATERAL_NOTES_PER_BORROW = 4`), mints 1 loan commitment, publishes 3
  bond commitments + a `loan_nullifier` sidecar public signal.
- **FR-S3:** `useLiquidate` fetches the sidecar and auto-branches v2/v1.
- **FR-S4:** BLS12-381 proof encoding centralized in `proof-encoding.ts`
  (tested, incl. the past G2-ordering hotfix — must stay covered).

### 4.5 Borrow flow UI (`features/borrow-flow/`) `[IMPLEMENTED]`

- **FR-B1:** Drawer flow with timeline steps (`steps.ts`,
  `flow-timeline.tsx`); quote math in bigint fixed-point
  (`quote.ts` + `features/shared/money` — money tested, quote itself untested,
  see §7 gap #5).
- **FR-B2:** Positions/activity from chain events (`chain-positions.ts`,
  `chain-activities.ts`) + tested session store.

### 4.6 Protocol layer (`features/protocol/`) `[IMPLEMENTED]`

- **FR-P1:** `AdapterResult<T>`/`AdapterError` union (`result.ts`, tested) is
  the shared error contract.
- **FR-P2:** Risk/rate params fetched once per session
  (`risk-params.ts`: `getRiskParams()`/`useRiskParams()`).
- **FR-P3 `[GAP — corrected]`:** Composition root is
  `features/shielded-pool/shielded-pool-provider.tsx`. There is **no**
  `AdapterProvider` and **no mock adapter** — stale CLAUDE.md claims; the mock
  path was removed. Stale comments remain in `features/protocol/types.ts`
  (cleanup candidate).
- **FR-P4:** Liquidation-service helpers (`liquidation-service.ts`) shared
  with the CLI. (Module-level cache never invalidates — known simplification.)

### 4.7 Privacy mode `[IMPLEMENTED]`

- **FR-PR1:** `PrivateValue` (tested) masks wallet addresses, proof IDs,
  receipt hashes, balances; must wrap all user-specific values.

### 4.8 Contract & circuits (`contracts/`) `[IMPLEMENTED on testnet]`

- **FR-C1:** Full shielded API per README (initialize, set_reserve,
  rate/risk params, register_market, admin_transfer, upgrade, 5 shielded ops +
  liquidate v1/v2, view fns).
- **FR-C2:** Verifier keys embedded per-circuit at
  `contracts/borrow-pool/src/vk/<circuit>/*.bin` (7 circuit dirs); circuits at
  `contracts/circuits/shielded-*` (Circom, BLS12-381, Poseidon).
- **FR-C3:** In-place upgrade (same contract ID, storage-compatible) is the
  required deployment mode. Acceptance: upgrade preserves nullifier set,
  Merkle roots, and open bonds.

### 4.9 Liquidation tooling (CLI) `[IMPLEMENTED]`

- **FR-L1:** `bun run scan:underwater` — read-only watchlist of live bonds,
  oldest first; `LOOKBACK_LEDGERS` configurable.
- **FR-L2:** Authenticated triage with `LIQUIDATION_SERVICE_SK`: decrypt
  memos, evaluate the circuit's underwater inequality, flag `**`.
- **FR-L3:** `--trigger` requires **both** `LIQUIDATION_SERVICE_SK` and
  `LIQUIDATOR_SECRET` (Stellar signing key); autonomous loop. Activation
  additionally requires the on-chain `liquidation_service_pk` slot set.
  `[shipped, awaiting config]`
- **FR-L4:** `bun run gen:service-key` keypair generator.

## 5. Non-Functional Requirements

| ID | Area | Requirement | Status |
|----|------|-------------|--------|
| NFR-P1 | Performance | Borrow proof ≤ 30s in-browser | **Target — documented estimate ~15–30s; no benchmark harness. Add timed check or keep as target, not "measured"** |
| NFR-P2 | Performance | `@stellar/freighter-api` async-chunks only; no radix-ui (`bun run check:bundle`) | Enforced post-build |
| NFR-C1 | Correctness | All asset math bigint fixed-point (`features/shared/money`); no float drift | Implemented + tested |
| NFR-PR1 | Privacy | Wallet↔note unlinkability via denominations, nullifiers, memo encryption | Identity now signature-derived (R1 fixed); UI masking implemented. Residual limit is the ~0 anonymity set (R4), not the key scheme |
| NFR-PR2 | Privacy | Liquidation service never holds *spending* keys (ivk/nk split, v2 circuit) | Implemented at design level; no enforcing test. Service does hold *viewing* capability pool-wide (R3) |
| NFR-S1 | Security | On-chain nullifier replay guard (per-tree namespaces: deposit vs loan, so cross-tree byte collisions cannot block a legitimate spend); Groth16 via Protocol 22 host fns; proof replay rejection; oracle freshness window | Implemented (no Rust unit tests — §7 gap #1) |
| NFR-S2 | Security | Oracle price *commitment* cross-checked on-chain | **Gap — planned (R7)** |
| NFR-S3 | Security | Production trusted setup | **Gap — mainnet blocker (R5)** |
| NFR-S4 | Security | Circuit artifacts in `public/` integrity-pinned; proving deps reviewed | Artifacts SHA-256-pinned via committed manifest + CI check; `circomlibjs` removed, `snarkjs` pinned (R8). Deep dep audit still gated |
| NFR-R1 | Reliability | Note inventory recoverable from chain events **within RPC event retention (~7 days)** | Window-bounded; persisted local note store is the only recovery path after retention (backup export/import removed 2026-07) |
| NFR-Q1 | Quality | lint/typecheck/test/build green; TS fixture harness covers circuit/contract primitives | Implemented; Rust tests blocked on soroban-sdk 23 |

## 6. Acceptance Criteria (P0)

QA-derived, Given/When/Then. These are the verifiable form of the P0 stories.

### Borrow

- Given ≥4 unspent deposit notes of asset X, when the user borrows, then the
  prover receives exactly 4 notes (rejects ≠4), and the tx mints 1 loan
  commitment, 3 bond commitments, and 1 `LoanNullifier` sidecar entry readable
  via contract query.
- Given <4 unspent notes (including notes spent since last scan), when borrow
  is attempted, then the preflight `nullifiers_used` check excludes spent notes
  and the flow fails with a clear error — no proof generation started.
- Given a proof whose `oracle_epoch` exceeds `MAX_ORACLE_AGE_SECS`, when
  submitted, then the contract returns `StaleOracle`, surfaced via
  `AdapterError`.
- Given the same proof submitted twice, then the second returns `ProofReplayed`.

### Repay

- Given `borrow_index_now > borrow_index_snapshot`, when repaying, then the
  deposit note must satisfy `deposit × snapshot ≥ loan × now`; a
  principal-only deposit fails once interest accrued.
- Given a successful repay, then both loan and deposit nullifiers are marked
  used and the scanner drops both notes next pass.

### Liquidate

- Given a bond with a `LoanNullifier` sidecar, liquidation invokes
  `liquidate_shielded_v2`; given none, v1 — assert both branch directions.
- Given a healthy position (HF ≥ min), liquidation proving fails or the
  contract returns `InvalidProof`.

### Scanner / recovery

- Given only on-chain events within the lookback window (localStorage
  cleared), when the scanner runs, then the rebuilt inventory equals the
  pre-clear inventory (note-set equality).
- Given a withdraw/repay/liquidate event spending nullifier N, then any note
  with nullifier N is excluded from the inventory.

### Liquidation CLI

- Given `LIQUIDATION_SERVICE_SK` unset, `--trigger` exits with a clear error
  before any RPC write; wrong-length SK errors name the expected format;
  `--trigger` without `LIQUIDATOR_SECRET` errors explicitly.

### Proof encoding

- `structureProof` output round-trips Soroban `G1/G2Affine::from_array` byte
  order (covered by `proof-encoding.test.ts` — must remain covered).

## 7. Test Coverage Gaps (ranked by risk)

Current suite: 23 TS test files, 170 tests. Recently closed: `quote.ts` math,
artifact-integrity loader, memo ephemeral-key freshness, R1 legacy-identity
backward-compat. Remaining gaps:

1. **Zero Rust contract tests** — nullifier/proof replay, oracle staleness,
   auth gating unverified except manually. Blocked on soroban-sdk 23; revisit.
2. **Lifecycle-hook branch tests** — borrow preflight nullifier-exclusion and
   the liquidate v2/v1 branch remain untested at the unit level (the latter is
   a one-line `!= null` in a heavy async hook; the e2e harness exercises the
   real paths).
3. ✅ **Closed — e2e prove→submit→verify harness** (`bun run test:e2e`) now
   asserts the on-chain borrow verify and runs on a schedule in CI. This is the
   primary regression net for the pub-signal-order / G2 / Merkle-budget class,
   so a fast unit duplicate (gap 4) was intentionally not added.
4. Prover public-signal ordering — covered end-to-end by the e2e harness (3),
   not by a standalone unit test.
5. ✅ **Closed — `quote.ts` tested** (LTV/HF/utilization/liquidation-price +
   null/zero-collateral edges).
6. **Oracle price path** (`prices.ts`, `price-cache.ts`, `market-stats.ts`)
   still lacks unit tests — though the invalid-strkey bug that broke it live is
   now fixed and the e2e run exercises the real Reflector read.
7. **`scan-underwater.ts` classification/trigger loop untested.**
8. **`risk-params.ts` / `liquidation-service.ts` untested** (thin wrappers;
   non-invalidating cache noted).

## 8. Current State vs Future State

| Dimension | Current | Future |
|---|---|---|
| Network | Stellar testnet, single upgradeable contract | Mainnet gated on audit + ceremony + multisig + oracle cross-check + legal position (BRD P2) |
| Identity | **Signature-derived, cached (R1 done)**; address scheme kept as legacy fallback | — |
| Recovery | Persisted local note store + ~7-day event scan (backup export removed 2026-07) | Indexer/archive, gated on mainnet |
| Proving | Real in-browser Groth16, artifacts hash-pinned (R8); dev trusted setup | Production ceremony / universal setup |
| Repay | Burns collateral notes; interest accrual live | v2 repay circuit: collateral recovery |
| Liquidation | v1 + v2 shipped; autonomous loop shipped-unconfigured; single trusted operator | Activate service; decentralization dropped (FROST) — operator trust stays unless revisited |
| Oracle | Reflector freshness check only (live-price strkey bug fixed) | On-chain commitment cross-check |
| Testing | TS unit (170) + fixture harness + **e2e testnet harness in CI (R6)** | Rust tests post soroban-sdk 23 |
| Docs | README + CLAUDE.md refreshed; canonical contract ID declared; BRD/PRD/REMEDIATION maintained | — |

## 9. Lifecycle (as implemented)

```
Freighter connect
  → identity = deriveShieldedIdentity(SHA-256(signMessage(canonical)))  ← R1: signature-derived, cached
  → scanner trial-decrypts vs [current identity, legacy address-derived]
     deposit|borrow events mint notes; withdraw|repay|liquidate spend nullifiers
  → note store → useNotes()
  → shielded drawer → useDeposit/useBorrow/useWithdraw/useRepay/useLiquidate
  → snarkjs Groth16 prover (artifacts hash-pinned via artifact-manifest.json)
  → contract call via TS bindings, signed by Freighter
  → contract verifies proof, burns/appends nullifiers/leaves, emits event + encrypted memo
  → next scan pass reflects the change
```

The old typed lifecycle state machine (`features/protocol/lifecycle.ts`,
`Idle → Quoting → … → Confirmed`) **no longer exists**; per-operation hooks own
their async progress. Errors flow through `AdapterResult`/`AdapterError`
(`features/protocol/result.ts`).

## 10. Open Questions

Business questions live in BRD §12; engineering remediation questions in REMEDIATION.md. PRD-level additions:

1. Delete dead code: legacy `borrow-eligibility-circom` dir, the stale
   mock-adapter `ProtocolAdapter` type in `features/protocol/types.ts`, and the
   unused `circomlib` dependency? (Deferred — flagged, not blockers.)
2. ✅ Done — `e2e-borrow.ts` wired to a scheduled CI job (`test:e2e`).
3. Superseded — backup feature deleted 2026-07; persisted note store +
   ~7-day event scan is the accepted recovery model.
4. Add a timed proof-generation benchmark so NFR-P1 becomes measured?
5. Degraded-privacy banner for wallets lacking `signMessage`? (Freighter has
   it; WalletConnect is scaffolding-only.)

---

**Status:** M1 (docs honest), M2 (trustworthy build), and M3 (privacy works)
of [REMEDIATION.md](./REMEDIATION.md) are complete. **Recommended next:**
(1) manual browser smoke-test of the R1 signature popup UX; (2) minor dead-code
cleanups (OQ #1 above); (3) v2 repay (collateral recovery); (4) M4 mainnet-gate
prerequisites remain gated on a mainnet decision.
