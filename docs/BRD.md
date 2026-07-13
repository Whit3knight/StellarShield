# Business Requirements Document (BRD)

## Stellar Shield — Borrow in the Open, Keep Your Positions in the Dark

**Version:** 2.0 | **Date:** 2026-07-13 | **Stage:** Testnet technical validation (not a market-facing product)
**Companion docs:** [PRD.md](./PRD.md) (product/technical scope), [REMEDIATION.md](./REMEDIATION.md) (engineering risk register)

> **What this document is.** A business-level statement of *why* Stellar Shield
> exists, *who* it is for, and *what success would look like*. It deliberately
> excludes code-level detail. Implementation specifics, circuit inventories, and
> the R1–R16 engineering risk register live in the PRD and REMEDIATION.md.
>
> **What this document is not.** A launch plan. Stellar Shield is currently a
> testnet technical validation — the cryptography works end-to-end, but there is
> no live user base, no revenue model, and no mainnet deployment. Where a
> business fact is unknown (market size, demand, willingness to pay), this
> document says so rather than inventing a number.

---

## 1. Executive Summary

Public-blockchain lending is radically transparent: anyone can read a wallet's
collateral, loan size, health factor, and liquidation price. That transparency
is a liability for serious borrowers — it enables liquidation front-running,
financial doxxing, and copy-trading. No lending protocol on Stellar offers
position privacy today.

Stellar Shield is a privacy-preserving lending pool on Stellar's Soroban smart
contract platform. It lets a user deposit collateral, prove they are eligible to
borrow, and take a loan — without revealing their wallet, balances, or position
size on-chain. Eligibility is proven with zero-knowledge proofs verified
directly on-chain using Protocol 22 cryptographic host functions.

The project has completed a full technical validation on testnet: the shielded
deposit → borrow → repay/liquidate lifecycle runs end-to-end with real
on-chain proof verification. This establishes a **first-mover technical
position** for zero-knowledge applications on Stellar. It does **not** yet
establish product-market fit, and this document treats demand as an open
hypothesis to be tested, not a proven fact.

## 2. Problem & Opportunity

### The problem

On transparent lending markets, a borrower's entire financial position is public
by default. This creates concrete business harms:

| Harm | Who it affects | Business impact |
|------|----------------|-----------------|
| **Liquidation front-running** | Any leveraged borrower | Bots watch public health factors and race to trigger/profit from liquidations at the borrower's expense. |
| **Financial doxxing** | Individuals, treasuries | A wallet address ties a real balance sheet to a public identity forever. |
| **Copy-trading / strategy leakage** | Funds, market makers | Loan sizes and entry levels reveal a strategy the moment it is on-chain. |

For institutional and professional participants, this transparency is often the
single reason on-chain lending is a non-starter.

### The opportunity

- **Position privacy on Stellar.** Stellar's ecosystem has no shielded lending
  option. Stellar Shield addresses a gap rather than competing head-on with an
  incumbent.
- **First-mover on Soroban Protocol 22 ZK.** The BLS12-381 host functions that
  make on-chain proof verification practical are recent. The field of
  zero-knowledge applications on Stellar is essentially empty. Being early
  establishes technical credibility and design leadership regardless of
  near-term adoption.
- **Shielded *lending* is rare even industry-wide.** Most privacy protocols
  shield *transfers*. Proving borrow eligibility (an LTV check against a live
  oracle price) inside a zero-knowledge proof is a harder and less-crowded
  problem than shielded payments.

## 3. Business Objectives & Goals

Objectives are split by stage. The current stage is validation; product and
market objectives are explicitly *gated* and not yet in scope.

### Stage 1 — Technical validation (current, achieved)

| # | Objective | Outcome |
|---|-----------|---------|
| B1 | Prove privacy-preserving lending is viable on Stellar/Soroban | Achieved — live on testnet with on-chain proof verification |
| B2 | Demonstrate a complete borrow lifecycle end-to-end | Achieved — deposit, borrow, claim, repay, liquidate all work |
| B3 | Establish first-mover technical credibility for ZK on Stellar | Achieved — working reference implementation exists |
| B4 | Keep the pool solvent without a central party holding user spending keys | Achieved — service-based liquidation path shipped |

### Stage 2 — Product validation (gated, not yet in scope)

| # | Objective | Gate before this becomes real |
|---|-----------|-------------------------------|
| B5 | Deliver *meaningful* privacy to real users (not just working cryptography) | Requires a large enough anonymity set — i.e. real pool volume — so that positions cannot be de-anonymized by correlation |
| B6 | Validate that demand for on-chain privacy on Stellar actually exists | Requires external users and a demand signal (see Open Questions) |
| B7 | Mainnet readiness | Requires third-party audit, trusted-setup ceremony, decentralized administration, and a documented legal/compliance position |

**Honesty note.** With today's implementation and testnet volume, the system
demonstrates the machinery of privacy but does not yet *deliver* privacy to a
real user, because privacy is a function of how many other users you blend in
with. This document does not claim otherwise.

## 4. Target Users & Jobs-to-be-Done

All external segments below are **hypotheses**. No demand signal has been
observed yet; validating them is Open Question OQ-1.

| Segment | Job-to-be-done | Status |
|---------|----------------|--------|
| Privacy-conscious Stellar holders | "Earn yield or take leverage without broadcasting my balance sheet to the world." | Hypothesis — unvalidated |
| Professional borrowers (funds, market makers) | "Borrow without leaking my position size and liquidation level to competitors and liquidation bots." | Hypothesis — unvalidated |
| Liquidation service operators | "Keep the pool solvent and earn a bounty for triggering liquidations on underwater positions." | Tooling shipped; permissionless-capable by design |
| Internal development team | "Prove the concept works and de-risk a future product decision." | Actual current user |

## 5. Value Proposition & Differentiation

**Core value proposition:** *Borrow in the open market, keep your position in the
dark.* Users get the economic function of a lending market (collateralized
borrowing against live oracle prices) without the surveillance cost of a fully
public position.

### Versus transparent Stellar lending

Existing/typical Stellar lending exposes every position publicly. Stellar Shield
is the only option that hides wallet, balances, and position size while still
enforcing solvency on-chain. This is a category difference, not a feature
comparison.

### Versus other privacy protocols

| Protocol | What it shields | How Stellar Shield differs |
|----------|-----------------|-----------------------------|
| **Zcash** | Private transfers (design inspiration for the note/nullifier model) | Stellar Shield shields *lending*, not payments, and runs on Stellar/Soroban |
| **Tornado-style pools** | Fixed-denomination transfer mixing | Stellar Shield adds a productive financial primitive (borrowing) on top of the shielded pool |
| **Aztec** | General private smart contracts (Ethereum) | Stellar Shield targets Stellar's low-fee, oracle-rich ecosystem and Protocol 22 host functions |

The differentiation is the **combination**: shielded *and* lending *and* on
Stellar. Each dimension alone has precedent; the intersection does not.

## 6. Business Model / Value Capture

**There is no revenue model today, and this document does not pretend
otherwise.** Stellar Shield is a testnet technical validation. It runs on
friendbot-funded test assets with no real value at risk.

The only value-capture mechanism that exists in the code is a **liquidation
bounty** (a fixed denomination paid to whoever liquidates an underwater
position). That is a solvency-incentive mechanism, not a protocol revenue
stream — it pays third-party liquidators, it does not accrue value to the
protocol or its operator.

Plausible future value-capture models (borrow-rate spread, reserve factor,
protocol fee) **exist in the rate parameters but are not activated as a
business model** and would only be meaningful at mainnet with real volume. Any
such model is out of scope until Stage 2 and would need to be weighed against
the regulatory exposure described in §9.

## 7. Scope (Business Capabilities)

Framed as business capabilities, not implementation. See PRD.md for the
technical breakdown (contracts, circuits, tooling).

### In scope (validated on testnet)

- **Shielded deposit** — put collateral into a private pool.
- **Shielded borrow** — prove eligibility and take a loan without revealing the
  position.
- **Claim & repay** — receive borrowed funds to a wallet and repay with interest.
- **Liquidation** — keep the pool solvent when a position goes underwater, via a
  path that does not require the borrower's spending keys.
- **Position recovery** — rebuild a user's private holdings from public chain
  data on a fresh device (bounded by a data-retention window; backup available).
- **Operator tooling** — a watchlist and triage capability for liquidation
  service operators.

### Out of scope (this stage)

- **Mainnet deployment** and everything it requires (audit, ceremony, legal
  position, decentralized administration).
- **A live user base and revenue model** — this is a demo, not a product launch.
- **Full de-anonymization resistance** — see the anonymity-set limitation in §9.
- **Removing operator trust from the liquidation service** — the liquidation
  service operator can currently see positions (accepted limitation; see §9).
- **A user-facing backend/server** — the user path is entirely client-side by
  design.

## 8. Success Metrics / KPIs

Two tiers. Stage-1 metrics are validation gates that have been met. Stage-2
metrics are the *business* bar and are **not measurable today by design** — they
define what would have to be true before this is a product.

### Stage 1 — validation KPIs (met)

| KPI | Target | Status |
|-----|--------|--------|
| Full shielded lifecycle repeatable on testnet | On demand | Met |
| On-chain proof verification succeeds | Every borrow | Met |
| Fresh-device position recovery from public data | Within retention window | Met (window-bounded) |

### Stage 2 — business KPIs (not yet measurable)

| KPI | Why it is the real bar |
|-----|------------------------|
| **Anonymity-set size per asset/denomination ≥ K** | This is a *product-quality* KPI, not a vanity metric. Below a threshold K, the privacy claim is vacuous no matter how strong the cryptography — a user cannot hide in a crowd of one. |
| **Total value locked (TVL)** | Indicates real capital trusting the pool. Zero today. |
| **Active borrowers (external, unassisted)** | The demand signal for B6. Zero external users today. |
| **Independent de-anonymization attempt fails** under a documented threat model | The only direct test of whether the product delivers on its core promise. |

None of the Stage-2 KPIs are measurable at testnet volume. Their absence is what
marks the current stage as a demo rather than a product.

## 9. Business Risks & Assumptions

Business-level risks only. Code-level defects and their remediation status are
tracked in [REMEDIATION.md](./REMEDIATION.md) (the R1–R16 register); they are
not reproduced here.

| # | Risk | Type | Business impact | Response |
|---|------|------|-----------------|----------|
| BR1 | **Unproven demand.** There is no evidence that users on Stellar want on-chain privacy at meaningful scale. Stellar's ecosystem skews compliance-heavy (regulated anchors, KYC'd assets), which is a counter-signal. | Market | The entire product thesis may be wrong. | Treat Stage 2 as a demand-validation experiment before any build-out (OQ-1). |
| BR2 | **Regulatory exposure of privacy pools.** The Tornado Cash precedent — contract-level sanctions and developer prosecution — is a genuine, not theoretical, risk for any privacy-preserving financial protocol. | Regulatory/legal | Could make mainnet deployment legally unviable or personally risky for the developer. | A documented legal position is a *gating input* to any mainnet decision, not a post-launch add-on (OQ-8). |
| BR3 | **Privacy that isn't yet private.** At testnet volume the anonymity set is effectively zero, so positions are correlatable despite the cryptography. If launched prematurely, the product would over-promise. | Product credibility | Reputational damage; users assume privacy they don't have. | Do not market as privacy-delivering until anonymity-set KPI (§8) is met. |
| BR4 | **Single-developer execution capacity.** A lending protocol demands audit-grade rigor across cryptography, smart contracts, oracle integration, and in-browser proving — currently held by one person. | Execution | The system must not custody real value under this model; velocity and bus-factor are constrained. | Keep on testnet; mainnet requires additional people and independent audit. |
| BR5 | **Sole oracle dependency.** Pricing depends entirely on a single oracle provider (Reflector). | Operational | An oracle outage, mispricing, or discontinuation directly threatens solvency and availability. | Interface is swappable in principle; a fallback source is a mainnet prerequisite. |
| BR6 | **Trusted liquidation operator.** The party running the liquidation service can currently see every borrower's position. | Product/privacy | Weakens the privacy promise against an insider; centralizes a sensitive role. | Disclosed as an accepted limitation; decentralizing it is the only removal path. |
| BR7 | **First-mover with no proven playbook.** Being early on Stellar ZK means no reference users, no established demand, and no peer protocols to learn from. | Strategic | Higher uncertainty; may be early to a market that doesn't materialize. | Frame as an option/credibility play, not a committed product bet. |

### Key business assumptions

- Position privacy is a real, currently-unmet need for *some* Stellar
  participants (unvalidated — BR1).
- Being first to ZK lending on Stellar has strategic value even if near-term
  adoption is low.
- A defensible legal/compliance path to mainnet exists (unverified — BR2).
- The technical validation transfers to a production system with additional
  audit, resourcing, and decentralization (assumed, not proven).

## 10. Constraints & Dependencies

Business, regulatory, and resourcing constraints. Technical constraints are in
the PRD.

- **Regulatory constraint.** Privacy-pool regulatory precedent (BR2) constrains
  whether and how this can ever reach mainnet. This gates the entire Stage-2
  transition.
- **Resourcing constraint.** Effectively one developer. Work must be sequenced,
  not parallelized; scope is capacity-bound (BR4).
- **No real-value constraint.** Testnet-only, friendbot-funded. No real assets
  are at risk, which is a deliberate safety constraint given BR4.
- **Oracle dependency.** The protocol depends on a single external price
  provider (Reflector). This is a live business dependency for correctness and
  availability, not just a technical integration (BR5).
- **Ecosystem dependency.** Relies on Stellar Development Foundation's Protocol
  22 host functions and continued Soroban support.
- **Mainnet gate dependencies.** Third-party audit, trusted-setup ceremony,
  decentralized administration, and legal counsel — none of which are secured
  today.

## 11. Stakeholders

| Role | Who | Primary interest |
|------|-----|------------------|
| Product owner / developer | Repo owner (single-developer project) | All strategic and technical decisions |
| Contract administrator | Testnet admin key holder (same person today) | Parameters, upgrades, reserves |
| Liquidation service operator | Same team currently | Pool solvency and bounty; holds position visibility (BR6) |
| Ecosystem partners | Stellar Development Foundation, Reflector | Protocol host functions, oracle feeds |
| Future stakeholders | Independent auditors, mainnet users, legal counsel | Funds safety, privacy delivery, regulatory compliance |

## 12. Open Business Questions

| # | Question | Owner |
|---|----------|-------|
| OQ-1 | Does the target user exist at meaningful scale on Stellar, and what concrete demand signal would validate it? | Product owner |
| OQ-2 | What anonymity-set size (K) is the minimum credible privacy bar, and how would it be reached? | Product owner |
| OQ-3 | Is there a viable legal/regulatory structure under which this could reach mainnet at all? | Legal counsel (future) |
| OQ-4 | If a revenue model is pursued, which mechanism (rate spread, reserve factor, fee) is both viable and regulatorily defensible? | Product owner |
| OQ-5 | What is the full mainnet-gate checklist and who owns each item (audit, ceremony, decentralized admin, oracle cross-check, legal position)? | Product owner |
| OQ-6 | Can the liquidation-operator trust (BR6) be removed, and is doing so a prerequisite for any real launch? | Product owner / operator |
