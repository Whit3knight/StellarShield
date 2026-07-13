# Business Requirements Document (BRD)

## Stellar Shield — Borrow in the Open, Keep Your Positions in the Dark

**Version:** 1.1 | **Date:** 2026-07-13 | **Status:** Remediation M1–M3 applied
**Companion docs:** [PRD.md](./PRD.md), [REMEDIATION.md](./REMEDIATION.md)

> **How this document was produced:** drafted from the live codebase and README,
> fact-checked against source (every "shipped" claim spot-verified) and
> adversarially reviewed. v1.1 folds in the completed remediation (M1–M3): the
> risk register (§8) marks what is now fixed, disclosed, or still gated.
> `CLAUDE.md`, README, and the canonical contract ID have since been
> reconciled with the code.

---

## 1. Problem Statement

DeFi lending on public blockchains is radically transparent: anyone can see a
wallet's collateral, loan size, health factor, and liquidation price. This
exposes users to liquidation front-running, doxxing of financial positions, and
copy-trading. On Stellar specifically, no lending protocol offers position
privacy.

Stellar Shield is a Zcash-style shielded pool on Soroban: deposits and loans are
Poseidon commitments in per-asset Merkle trees, spends are guarded by
nullifiers, and borrow eligibility (LTV against an oracle price) is proven with
Groth16 zero-knowledge proofs verified on-chain via Protocol 22 BLS12-381 host
functions.

## 2. Business Objectives

The project is currently a **technical validation on testnet**, not a
market-facing product. Objectives are split accordingly.

### Demonstration objectives (current phase)

| # | Objective | Status |
|---|-----------|--------|
| D1 | Prove Groth16-verified shielded lending is viable on Stellar/Soroban (Protocol 22 BLS12-381) | Live on testnet |
| D2 | Complete borrow lifecycle: deposit → borrow → claim loan → repay (with interest) / liquidate | Shipped |
| D3 | Note inventory rebuildable from public chain data via encrypted memos, within RPC event retention | Shipped (bounded — see Risks R2) |
| D4 | Keep pool solvent via a liquidation path that does not require borrower spending keys | Shipped (v2 circuit, ivk/nk split) |

### Product objectives (gated — not yet in scope)

| # | Objective | Gate |
|---|-----------|------|
| P1 | Deliver *actual* privacy to users (anonymity set large enough that linkage attacks fail) | Signature-based identity now shipped (R1); still requires meaningful pool volume and mitigation of timing/pattern correlation |
| P2 | Mainnet deployment | Requires: third-party audit, trusted-setup ceremony, admin multisig, oracle commitment cross-check, explicit compliance/legal position |

**Honesty note:** with the current implementation and testnet volume, the
system demonstrates the cryptographic machinery; it does not yet deliver
privacy to a real user. The BRD deliberately does not claim otherwise.

## 3. Target Users

| User | Description | Status |
|------|-------------|--------|
| Privacy-conscious Stellar holders | Want yield/leverage without broadcasting balance sheet | **Hypothesis — no demand signal yet.** Validating this is an open question (OQ-1) |
| Borrowers with position-privacy needs | Funds/market makers whose loan sizes and liquidation levels are exploitable if public | Hypothesis |
| Liquidation service operators | Run the watchlist/trigger CLI for a bounty (1× denomination per liquidation) | Tooling shipped; permissionless-capable by design |
| Internal development team | Current de-facto sole user; testnet/demo stage | Actual |

## 4. Market Context

- Soroban + Protocol 22 BLS12-381 host functions are recent; the field for ZK
  applications on Stellar is essentially empty — first-mover technical position.
- Precedents: Zcash (notes/nullifiers — direct design inspiration),
  Tornado-style fixed-denomination pools, Aztec. Shielded *lending* is rarer
  than shielded transfer.
- Oracle: Reflector (SEP-40) is the sole price source on testnet.
- Regulatory: privacy pools attract severe scrutiny (Tornado Cash precedent —
  contract-level OFAC sanctions, developer prosecution). See R11: this is a
  gating input to any mainnet decision, not a post-launch add-on.
- Counter-signal to the market hypothesis: Stellar's ecosystem is
  compliance-heavy (anchors, SEP-8 regulated assets); demand for on-chain
  privacy on Stellar specifically is unproven.

## 5. Scope

### In scope (implemented on testnet)

- Shielded pool contract (`contracts/borrow-pool/`): deposit, withdraw, borrow
  (4 collateral notes → loan note + 3 bond commitments + loan-nullifier
  sidecar), withdraw-loan, repay with interest accrual, liquidate (v1
  self-liquidate + v2 service path), rate/risk params, market registry,
  in-place upgrade.
- Seven Circom/Groth16 circuits (`contracts/circuits/`): shielded-deposit,
  shielded-deposit-quad, shielded-borrow, shielded-withdraw, shielded-repay,
  shielded-liquidate, shielded-liquidate-v2. (Legacy
  `borrow-eligibility-circom` also present — retired, cleanup candidate.)
- Next.js 16 dashboard: markets with Reflector prices, Freighter wallet,
  shielded operation drawers, chain-derived positions/activity, privacy mode,
  note backup export/import.
- Liquidation tooling: `scan:underwater` watchlist, authenticated triage
  (`LIQUIDATION_SERVICE_SK`), autonomous trigger (`--trigger` +
  `LIQUIDATOR_SECRET`), `gen:service-key`.

### Out of scope (current phase)

- Mainnet, trusted-setup ceremony, third-party audit.
- Collateral recovery on repay (v1 burns original collateral notes).
- On-chain oracle price-commitment cross-check (freshness only today).
- FROST/threshold decryption for the liquidation service (**dropped** —
  consequence: the service is a single trusted party, see R3).
- Variable deposit amounts (fixed denominations are a privacy design choice).
- Rust contract unit tests (blocked on soroban-sdk 23; TS fixture harness is
  the stopgap).
- Any backend/server for the *user* path (the liquidation service is an
  operator-side keyed process — see R3 for the honest framing).

## 6. Success Metrics

Split per adversarial review: engineering acceptance criteria are build gates,
not product success.

### Engineering acceptance (current phase)

| Metric | Target | Status |
|---|---|---|
| E2E testnet lifecycle (README 8-step verification) repeatable | On demand | Implemented — `bun run test:e2e` proves→submits→verifies on-chain; scheduled CI workflow |
| Borrow proof generation in-browser | ≤ 30s | **Documented estimate (~15–30s), no benchmark harness — unverified target** |
| Fresh-browser note recovery from chain events | 100% **within RPC retention window** | Implemented; window-bounded (R2) |
| CI gates: lint, typecheck, test, build, check:bundle | Green on main | Enforced |
| Watchlist enumerates live liquidation bonds | 100% within lookback | Implemented |

### Product success (define before any mainnet conversation)

| Metric | Why it matters |
|---|---|
| Anonymity set per asset/denomination ≥ K (K to be defined) | Below threshold, privacy claim is vacuous regardless of cryptography |
| Independent analyst fails a wallet↔note linkage attempt under a documented threat model | The only direct test of the product hypothesis |
| ≥ N external users complete a full lifecycle unassisted | Demand-signal + UX validation |

None of these are measurable today; that is by design — they define the bar,
and their absence marks the current phase as a demo.

## 7. Stakeholders

| Role | Who | Interest |
|---|---|---|
| Product owner / developer | Repo owner (single-developer project) | All decisions |
| Contract admin | Testnet admin key (`GCGLOK...GPXK`) | Params, upgrades, reserves |
| Liquidation service operator | Same team currently | Bounty revenue, pool solvency; holds pool-wide position visibility (R3) |
| Ecosystem | SDF, Reflector | Protocol 22 host fns, oracle feeds |
| Future | Auditors, mainnet users, legal counsel | Funds safety, compliance |

## 8. Risks

Ranked. R1–R3 were originally **claims the code contradicted**. R1 and R3 are
now addressed (see status below); the rest are fixed, disclosed, or gated.

**Remediation status (2026-07-13)** — tracked in [REMEDIATION.md](./REMEDIATION.md):

- **Resolved in code:** R1 (identity now derived from a Freighter signature,
  address scheme kept only as legacy decrypt fallback), R2 (recovery bound
  disclosed + unsaved-note backup nudge + legacy-identity backup import),
  R6 (e2e prove→submit→verify harness with on-chain assertion, wired to CI),
  R8 (circuit artifacts hash-pinned via a committed manifest; unused
  `circomlibjs` removed; `snarkjs` pinned), R9 (memo nonce reviewed — safe;
  safety rests on a one-time key per memo, documented), R15 (README accrual
  contradiction reconciled), R16 (canonical contract ID declared — fixed a
  live split-brain where the CLI operated a different contract than the app;
  CLAUDE.md refreshed; stale mock comments removed).
- **Disclosed as accepted limitation:** R3, R4, R7 (README trust-model +
  privacy-limitations section).
- **Still gated to a mainnet decision:** R5, R11, R12, R14, and the on-chain
  half of R7. R10, R13 parked until real traffic / incident.
- Also fixed en route: an invalid simulation-source strkey that was breaking
  live Reflector pricing app-wide.

| # | Risk | Severity | Notes |
|---|------|----------|-------|
| R1 | **Shielded identity derived from the public wallet address** (`use-shielded-identity.ts`: seed = SHA-256 of the G... address). Anyone knowing the address can recompute the X25519 secret key, decrypt all memos, and reconstruct the full note inventory. The intended signature-based derivation was rejected for UX and never shipped; README/code comments still describe it. | ✅ **Resolved** (was critical) | Now derived from a Freighter `signMessage` signature, cached per browser; address scheme retained only as a legacy decrypt/spend fallback. |
| R2 | **Note recovery bounded by RPC event retention.** Scanner looks back 10,000 ledgers (~14h) against public RPC, which itself has limited event retention. Notes older than the window are invisible on a fresh browser — funds effectively unspendable without a backup. | ✅ **Resolved** (was critical) | Bound disclosed in README; app shows an "N unsaved" backup nudge; backup import retries the legacy identity. Indexer/archive deliberately not built (single-dev testnet). |
| R3 | **Liquidation service is a trusted deanonymizing party.** Borrow memos are encrypted to borrower *and* `liquidation_service_pk`; the operator decrypts every borrower's position (collateral, loan, price). "Solvent without deanonymizing" holds only against outsiders. FROST decentralization was dropped. | **High — contradicts privacy framing** | Docs must name the operator as trusted with pool-wide visibility. Decentralizing it is the only removal path. |
| R4 | **Anonymity set ≈ 0.** Tiny fixed denominations (USDC/EURC 10, XLM 100), low testnet volume, and the distinctive 4-notes-then-borrow fingerprint make timing/amount correlation trivial for any motivated analyst. | High | Privacy is a function of set size; reframed objectives (P1) reflect this. |
| R5 | **No trusted-setup ceremony** — `.zkey`/`.ptau` are locally generated dev artifacts; holder of toxic waste can forge proofs. | Critical for mainnet | Real ceremony or universal setup before mainnet. |
| R6 | **Unaudited circuits and contract; zero Rust unit tests; no automated e2e prove→submit→verify harness.** Three recent hotfixes (pub-signal order, G2 encoding, Merkle budget) all in the class one e2e harness would catch. | ✅ **Harness resolved**; audit gated | `bun run test:e2e` proves→submits→verifies on-chain and fails loudly; scheduled CI workflow added. Third-party audit + Rust unit tests remain gated (soroban-sdk 23). |
| R7 | **Oracle price commitment not cross-checked on-chain** (freshness only; contract's own comment confirms the gap). A proof can commit to a price that differs from the live oracle. | High | Blocked on attestation channel; solvency leans on an unenforced binding. |
| R8 | **Client-side crypto supply chain**: snarkjs / circomlibjs (old, unmaintained) run in-browser over secret witnesses; circuit artifacts (`.wasm`/`.zkey`) served from `public/` with no integrity pinning. A compromised dep or swapped artifact exfiltrates or subverts proofs. | ✅ **Resolved** | All provers load artifacts through a shared SHA-256-pinned loader (committed manifest, CI-checked); unused `circomlibjs` removed and blocked; `snarkjs` pinned exact. Deep dep audit still gated to mainnet. |
| R9 | **Memo nonce derivation**: ChaCha20-Poly1305 nonce = first 12 bytes of ephemeral pk; uniqueness rests on ephemeral-key generation. Nonce reuse under a fixed key is catastrophic. | ✅ **Reviewed — safe** | Each memo derives a one-time ChaCha key from a fresh ephemeral key, so nonce reuse is not the safety property; the never-reuse-ephemeral invariant is now documented and test-guarded. |
| R10 | **Scanner DoS**: every client attempts trial-decryption of all memos each pass; adversarial event spam inflates scan cost. | Medium | Rate/shape limits or pagination strategy. |
| R11 | **Regulatory exposure** (Tornado Cash precedent: contract-level sanctions, developer prosecution). No compliance design exists; it is a **gating input** to the mainnet decision (P2), not deferrable past it. | High (mainnet) | Obtain a legal position before any mainnet work. |
| R12 | **Single admin key** for params/upgrade. | Medium | Multisig/governance before mainnet. |
| R13 | **Reflector single-oracle dependency**; SEP-40 is a swap point but no fallback exists. | Medium | — |
| R14 | **Single developer vs lending-protocol security bar.** Five audit-heavy surfaces (circuits, contract, oracle, in-browser proving, keeper) held by one person; recent hotfix history shows the failure mode. | High | System must not hold real value under this model; mainnet requires added people/audit. |
| R15 | **Interest-accrual documentation contradiction**: README roadmap says shipped (Track D), README "Deferred" section says deferred. Accrual enforcement (`deposit × index_snapshot ≥ loan × index_now`) has fixture coverage but no on-chain test. | ✅ **Resolved** | README reconciled — accrual shipped, only collateral recovery deferred. |
| R16 | **Stale docs** (`CLAUDE.md` describes retired architecture and non-existent tests) and **contract-ID ambiguity** (README documents one contract ID; `.env.local` points the app at a different one). | ✅ **Resolved** | Canonical contract ID declared across README/.env/CLI (fixed a live split-brain); CLAUDE.md refreshed; stale mock comments removed. |

## 9. Constraints

- Client-side proving only (snarkjs Groth16, BLS12-381 in-browser); no proving
  server. Bounds circuit size and UX (~15–30s borrow proofs).
- Fixed denominations per asset (anonymity-set design choice; constrains UX).
- Soroban Protocol 22 host functions; contract upgrades must stay in place
  (same contract ID, storage-compatible).
- Bun package manager; Next.js 16 App Router.
- Testnet economics — friendbot-funded, no real value at risk.
- Effectively one developer — work must be sequenced, not parallelized.

## 10. Open Questions

| # | Question | Owner |
|---|----------|-------|
| OQ-1 | Does the target user exist at meaningful scale on Stellar? What demand signal would validate P1? | Product owner |
| OQ-2 | ✅ Resolved — accepted the one-time-per-browser signature popup; R1 shipped with localStorage-cached seed. | Done |
| OQ-3 | ✅ Resolved — promote the existing backup flow (unsaved-note nudge + legacy-identity import); no indexer for a single-dev testnet. | Done |
| OQ-4 | ✅ Resolved — `shielded-deposit-quad` documented as experimental/unwired in the README roadmap (it is used by the e2e provisioning script, not the app UI). | Done |
| OQ-5 | Mainnet gate checklist owner and criteria (audit, ceremony, multisig, oracle cross-check, legal position)? | Open — Product owner |
| OQ-6 | Liquidation service activation on testnet: who holds the service SK; when is `liquidation_service_pk` set? | Open — Operator |
| OQ-7 | ✅ Resolved — circuit build artifacts gitignored; published artifacts pinned by SHA-256 manifest (R8). | Done |
| OQ-8 | Under what legal structure, if any, could this reach mainnet? | Open — Counsel (future) |
