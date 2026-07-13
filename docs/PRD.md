# Product Requirements Document (PRD)

## Stellar Shield — Borrow in the Open, Keep Your Positions in the Dark

**Version:** 1.0 | **Date:** 2026-07-13 | **Status:** Draft for review
**Companion doc:** [BRD.md](./BRD.md) (business context, risks R1–R16, open questions)

**Legend:** `[IMPLEMENTED]` = live in code, testnet-real · `[PLANNED]` = roadmap
· `[DROPPED]` = explicitly abandoned · `[GAP]` = claim the code contradicts,
fixed here to match reality.

Every requirement below was fact-checked against source. Two widely-circulated
claims from older docs are **false** and corrected here: identity is derived
from the wallet *address*, not a signature (FR-N1); and there is no
`AdapterProvider`/mock-adapter switch — the composition root is
`features/shielded-pool/shielded-pool-provider.tsx` (FR-P3).

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

- **Testnet contract (README):** `CBJZP45HUUVXWDSEUIQPDJD4RZPTUJUG6IGVM7HQPHRK74SHKPXF4N7L`
  — note `.env.local` currently targets a different ID; canonical ID must be
  declared (BRD OQ / R16).
- **Registered markets:** USDC/XLM, XLM/USDC, EURC/USDC, USDC/EURC, EURC/XLM, XLM/EURC.

## 2. User Personas

1. **Priya, depositor** — parks testnet XLM/USDC in the shielded pool, later
   withdraws. Wants deposit and withdrawal unlinkable (currently limited — BRD
   R1/R4).
2. **Boris, borrower** — deposits ≥4 collateral notes, borrows, claims loan,
   repays with interest. Wants loan size and liquidation level private.
3. **Lena, liquidation operator** — runs `bun run scan:underwater` (optionally
   `--trigger`) for the bounty. Never holds borrower *spending* keys (v2
   circuit), but **does** decrypt all borrowers' position openings (BRD R3).
4. **Devon, developer/admin** — deploys/upgrades contract, sets params,
   registers markets, maintains circuits.

## 3. User Stories

### P0 — core lifecycle `[IMPLEMENTED]`

- Connect Freighter on testnet; derive a shielded identity so my notes are
  discoverable by me. *(Currently derivable by anyone knowing my address —
  R1.)*
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
- Export/import encrypted notes backup (`features/notes/backup.ts`).
  `[IMPLEMENTED]` — should be promoted from optional to recommended while
  recovery is window-bounded (BRD R2).
- Repay returns collateral notes to the deposit tree. `[PLANNED — v2 repay circuit; v1 burns collateral]`
- Multi-note deposit in one proof. `[STATUS UNCLEAR — `shielded-deposit-quad`
  circuit + `deposit-quad-prover.ts` exist but are in no roadmap track; BRD OQ-4]`

### P2 — future

- WalletConnect. `[SCAFFOLDING ONLY]`
- On-chain oracle price-commitment cross-check. `[PLANNED — blocked on attestation channel]`
- Signature-based shielded identity derivation. `[PLANNED — required to close BRD R1]`
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

- **FR-N1 `[GAP]`:** Deterministic X25519 identity derived from
  **SHA-256 of the public wallet address** (`use-shielded-identity.ts`) — the
  signature-based scheme described in README/code comments was rejected for UX
  and is unshipped. Requirement going forward: migrate to a secret-input
  derivation (BRD R1, OQ-2); until then all privacy claims carry this caveat.
- **FR-N2:** `scanner.ts` is the sole inventory builder: `deposit`/`borrow`
  events mint notes; `withdraw`/`repay`/`liquidate` events mark nullifiers
  spent; each memo trial-decrypted. Lookback: 10,000 ledgers (NFR-R1).
- **FR-N3:** In-memory note store replaced wholesale per scan; surfaced via
  `useNotes()`.
- **FR-N4:** Poseidon commitments + Merkle paths client-side (`poseidon.ts`,
  `merkle.ts` — tested against fixtures shared with the contract).
- **FR-N5:** Encrypted backup export/import (`backup.ts`, `use-notes-backup`).

### 4.4 Shielded pool operations (`features/shielded-pool/`) `[IMPLEMENTED]`

- **FR-S1:** Hooks `useDeposit`, `useBorrow`, `useWithdraw`, `useRepay`,
  `useLiquidate`; each pairs a snarkjs prover wrapper (`*-prover.ts`, artifacts
  from `public/circuits-circom/shielded/*`) with generated TS bindings
  (`features/protocol/bindings`), signed via Freighter.
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
| NFR-PR1 | Privacy | Wallet↔note unlinkability via denominations, nullifiers, memo encryption | **Partial — broken by address-derived identity (R1) and ~0 anonymity set (R4); UI masking implemented** |
| NFR-PR2 | Privacy | Liquidation service never holds *spending* keys (ivk/nk split, v2 circuit) | Implemented at design level; no enforcing test. Service does hold *viewing* capability pool-wide (R3) |
| NFR-S1 | Security | On-chain nullifier replay guard; Groth16 via Protocol 22 host fns; proof replay rejection; oracle freshness window | Implemented (no Rust unit tests — §7 gap #1) |
| NFR-S2 | Security | Oracle price *commitment* cross-checked on-chain | **Gap — planned (R7)** |
| NFR-S3 | Security | Production trusted setup | **Gap — mainnet blocker (R5)** |
| NFR-S4 | Security | Circuit artifacts in `public/` integrity-pinned; proving deps supply-chain reviewed | **Gap (R8)** |
| NFR-R1 | Reliability | Note inventory recoverable from chain events **within scanner lookback (10,000 ledgers ≈ 14h) and RPC event retention** | Implemented, window-bounded. Older notes need the backup file (R2) |
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

Current suite: 19 TS test files (money, proof-encoding, result, fixtures,
merkle, scanner, notes, backup, markets, wallet/network, session-store,
private-value, etc.). Gaps:

1. **Zero Rust contract tests** — nullifier/proof replay, oracle staleness,
   auth gating unverified except manually. Blocked on soroban-sdk 23; revisit.
2. **No tests for the five lifecycle hooks** — priority: borrow preflight
   nullifier-exclusion logic and the liquidate v2/v1 branch.
3. **No automated e2e prove→submit→verify harness** — all three recent
   hotfixes were in its catch class; `contracts/scripts/e2e-borrow.ts` exists
   but is unwired. **Highest-ROI next item.**
4. **Prover input-assembly (public-signal ordering) untested** — exact class
   of a past hotfix.
5. **`quote.ts` untested** (older docs falsely claimed coverage) — LTV/HF/
   liquidation-price math feeds user decisions.
6. **Oracle price path untested** (`prices.ts`, `price-cache.ts`,
   `market-stats.ts`) — a decimals bug silently mis-triages health.
7. **`scan-underwater.ts` classification/trigger loop untested.**
8. **`risk-params.ts` / `liquidation-service.ts` untested** (thin wrappers;
   non-invalidating cache noted).

## 8. Current State vs Future State

| Dimension | Current | Future |
|---|---|---|
| Network | Stellar testnet, single upgradeable contract | Mainnet gated on audit + ceremony + multisig + oracle cross-check + legal position (BRD P2) |
| Identity | Address-derived (R1) | Signature-derived (secret input) |
| Recovery | 10k-ledger window against public RPC | Indexer/archive or mandatory backup flow |
| Proving | Real in-browser Groth16, dev trusted setup | Production ceremony / universal setup |
| Repay | Burns collateral notes; interest accrual live | v2 repay circuit: collateral recovery |
| Liquidation | v1 + v2 shipped; autonomous loop shipped-unconfigured; single trusted operator | Activate service; decentralization dropped (FROST) — operator trust stays unless revisited |
| Oracle | Reflector freshness check only | On-chain commitment cross-check |
| Testing | TS unit + fixture harness | E2E testnet harness (next priority); Rust tests post soroban-sdk 23 |
| Docs | README mostly current (one internal contradiction); CLAUDE.md stale | Refresh CLAUDE.md; reconcile README accrual status; declare canonical contract ID |

## 9. Lifecycle (as implemented)

```
Freighter connect
  → deriveShieldedIdentity(SHA-256(address))        ← R1: to become signature-based
  → scanner: deposit|borrow events mint notes; withdraw|repay|liquidate spend nullifiers
  → note store → useNotes()
  → shielded drawer → useDeposit/useBorrow/useWithdraw/useRepay/useLiquidate
  → snarkjs Groth16 prover (artifacts from public/circuits-circom/shielded/*)
  → contract call via TS bindings, signed by Freighter
  → contract verifies proof, burns/appends nullifiers/leaves, emits event + encrypted memo
  → next scan pass reflects the change
```

The old typed lifecycle state machine (`features/protocol/lifecycle.ts`,
`Idle → Quoting → … → Confirmed`) **no longer exists**; per-operation hooks own
their async progress. Errors flow through `AdapterResult`/`AdapterError`
(`features/protocol/result.ts`).

## 10. Open Questions

Product/business questions live in BRD §10 (OQ-1…OQ-8). PRD-level additions:

1. Delete legacy `borrow-eligibility-circom` and stale mock-adapter comments in
   `features/protocol/types.ts`?
2. Wire `e2e-borrow.ts` into a scheduled/gated CI job — owner and cadence?
3. Promote notes backup from optional to recommended UX while recovery is
   window-bounded?
4. Add a timed proof-generation benchmark so NFR-P1 becomes measured?

---

**Recommended next-track priority:** (1) e2e testnet harness; (2) fix R1
identity derivation — it gates every privacy claim; (3) CLAUDE.md/README/
contract-ID hygiene; (4) resolve deposit-quad status; (5) v2 repay (collateral
recovery).
