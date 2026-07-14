# Business Requirements Document (BRD)

## Stellar Shield — Borrow in the Open, Keep Your Positions in the Dark

**Version:** 2.1 | **Date:** 2026-07-13 | **Stage:** Testnet technical validation (not a market-facing product)
**Companion docs:** [PRD.md](./PRD.md) (product/technical scope), [REMEDIATION.md](./REMEDIATION.md) (engineering risk register)

> **What this document is.** A business-level statement of *why* Stellar Shield
> exists, *who* it is for, and *what success would look like*. It deliberately
> excludes code-level detail. Implementation specifics, circuit inventories, and
> the R1–R16 engineering risk register live in the PRD and REMEDIATION.md.
>
> **What this document is not.** A launch plan. Stellar Shield is currently a
> testnet technical validation — the cryptography works end-to-end, but there is
> no live user base, no revenue model, and no mainnet deployment. Where a
> business fact is unknown (this product's demand, TVL, willingness to pay), this
> document says so rather than inventing a number.
>
> **On the numbers in v2.1.** This version adds real, cited market data (see §2
> and the [Sources](#sources) list). Every external figure describes the *market
> and the category* Stellar Shield sits in — Stellar's DeFi growth, the scale of
> DeFi lending, the demonstrated appetite for on-chain privacy. **None of it is
> this product's traction.** Stellar Shield has zero users, zero TVL, and zero
> revenue as of 2026-07-13. A large addressable market with a zero-adoption
> product is the honest, complete picture, and this document keeps both halves of
> it visible. Crypto figures move fast; each is date-stamped "as of <date>."

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

### Market context & evidence

The following figures size the *market and category* Stellar Shield sits in.
They are supporting evidence for the opportunity thesis, not evidence of this
product's traction (which is zero — see the v2.1 note above). Every figure is
cited in [Sources](#sources) with a URL and access date; all were accessed
2026-07-13.

**1. Stellar's DeFi ecosystem is small but growing fast — and now technically
capable of on-chain ZK.** Stellar's on-chain DeFi TVL crossed $200M for the
first time in late April 2026, printing ~$197.4M on 2026-04-24, after sitting
under $12M in November 2024 and near $46M in May 2025 — roughly 284% YoY growth
through 2025 [S1, S2]. The growth is led by lending and tokenized real-world
assets: Blend, Stellar's main lending protocol, holds ~$110M TVL [S1]. Critically
for this project, Protocol 22 shipped to mainnet on 2024-12-05, introducing the
CAP-0059 BLS12-381 host functions that make on-chain zk-SNARK verification
practical [S3, S4]. That capability is roughly 18 months old as of this writing —
Stellar Shield is building on a primitive that did not exist before late 2024.
The broader ecosystem is non-trivial (Stellar reports ~10.1M total addresses and
5.1B operations since 2015 [S13]) and Soroban development is active (54 projects
in Stellar's Security Audit Bank as of Feb 2026; 160+ funded via the Soroban
adoption fund [S5]) — but shielded lending is absent from all of it.

**2. DeFi lending is a large, proven category — Stellar Shield's primitive is not
exotic, only its privacy is.** DeFi lending protocols held roughly $54B in
deposits as of April 2026, with Aave V3 alone at ~$19.4B; the lending category is
tracked across 380+ protocols on 80+ chains [S6, S7]. Aave grew from ~$8B (early
2024) to $40B+ (Aug 2025) [S8]. This matters two ways: the *demand for
collateralized on-chain borrowing* is established at tens of billions of dollars,
and Stellar's share of it is tiny — leaving room to compete on a dimension
(privacy) that no lending incumbent offers.

**3. Demand for on-chain privacy is demonstrated, not hypothetical.** Zcash — the
note/nullifier design Stellar Shield's shielded pool is modeled on — carried a
~$9–9.5B market cap (rank ~#14) in May 2026, and, more tellingly, over 30% of ZEC
supply (>4.9M ZEC) was held in the shielded pool by May 2026, up from ~8% in early
2024; shielded transactions hit 59.3% of activity in Feb 2026 [S9]. Privacy usage
is *growing* as a share of a multi-billion-dollar asset. On the professional side,
Flashbots data put cumulative Ethereum MEV over $1.8B by mid-2025 ($40–60M/month),
and by mid-2025 more than 50% of high-value Ethereum transactions were routed
through private channels [S10] — direct evidence that sophisticated actors already
pay to hide their intent from a transparent chain. The structural argument is
widely stated: public execution, where strategies and balances are visible to
competitors before confirmation, is a barrier to institutional participation in
DeFi [S10]. This substantiates the "professional borrower" segment in §4 as a real
demand vector — though, per BR1, it remains *unvalidated specifically for Stellar*.

**4. The same evidence carries a cautionary tale — privacy is a regulated and
commercially hazardous space.** The demand signal above sits next to a hard
lesson. Tornado Cash peaked near $1.17B TVL (Oct 2021), held ~$460.6M at the time
of sanctions, and processed over $7B in total volume before being sanctioned by
OFAC on 2022-08-08 [S11, S12]; its TVL fell ~60% within weeks. And Aztec — a
better-funded, dedicated privacy team — *sunset* its Aztec Connect privacy rollup
(sequencer stopped 2024-03-31), explicitly because it could not decentralize a
single-node system without a massive re-architecture [S14]. Both are direct
precedents for risks this project already names: regulatory exposure (BR2) and
the operator-centralization problem (BR6). The market wants privacy; the
graveyard shows it is hard to deliver in a way that is both decentralized and
legally durable. Stellar Shield's honest position is that it has *proven the
cryptography*, not that it has solved either of those problems.

**Net thesis.** A fast-growing but privacy-blind lending ecosystem (Stellar),
a large and proven lending category (DeFi lending at tens of billions), and a
demonstrated, growing appetite for on-chain privacy (Zcash shielded-pool growth,
paid MEV protection) together define a real, unserved opportunity — while the
Tornado Cash and Aztec precedents keep the risk honest. Stellar Shield is a
first-mover technical bet on that intersection, not a product with traction.

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

### Positioning statement (USP)

> **For** professional and privacy-conscious borrowers on Stellar **who** need
> collateralized leverage but cannot afford to broadcast their balance sheet,
> position size, and liquidation level to the entire chain, **Stellar Shield is**
> a privacy-preserving lending pool **that** lets you prove borrow eligibility and
> take a loan while your wallet, balances, and position size stay hidden on-chain.
> **Unlike** transparent Stellar lenders (Blend and every other Stellar lending
> market), which expose every position publicly, **and unlike** shielded-*transfer*
> tools (Zcash, Tornado-style pools), which hide payments but offer no borrowing
> primitive, **Stellar Shield** is the only option that combines shielded privacy
> *with* a lending market on Stellar — **because** eligibility is enforced by a
> real zero-knowledge proof verified *on-chain* via Protocol 22 BLS12-381 host
> functions, proofs are generated *client-side* so no server ever custodies a
> user's keys, and a user's private position can be rebuilt from public chain data
> alone.

**What makes it uniquely defensible:**

- **Category of one on Stellar.** It is the only *shielded lending* option in the
  Stellar ecosystem — a gap, not a head-to-head fight with an incumbent (§2).
- **On-chain ZK verification, not off-chain trust.** Borrow eligibility is proven
  with a zk-SNARK verified directly on-chain using Protocol 22 BLS12-381 host
  functions (live on mainnet since 2024-12-05 [S3]) — solvency is enforced by the
  chain, not by a trusted server.
- **Client-side proving, no key custody.** Proofs are generated in the user's
  browser. No backend server holds spending keys or sees plaintext positions on
  the user path, which removes an entire class of custody and honeypot risk.
- **Recover from the chain alone.** A user's private holdings can be reconstructed
  from public chain data on a fresh device (within the data-retention window),
  so there is no server-side account a user depends on to access their funds.
- **The intersection is the moat.** Shielded *and* lending *and* on Stellar *and*
  on-chain-verified: each dimension has precedent individually, but the
  combination does not exist elsewhere. Replicating it requires ZK, lending,
  oracle, and in-browser proving competence in one place.

**Honesty caveat on the USP.** "Only option" and "uniquely defensible" describe
the *technical and competitive position* today; they are not a claim of delivered
privacy. Real privacy also requires a large anonymity set (§8, BR3), which
testnet volume does not provide. The USP is a first-mover technical position, not
a finished product promise.

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

**Where revenue would come from (designed, not active).** The governing
constraint is that a shielded pool cannot bill an identity — so a fee can only
be baked into the interest index or note math, never charged per account. That
narrows the answer to essentially one mechanism: a **reserve factor** — the
protocol keeps a fraction (benchmark: Aave 10% on stablecoins, 10–35% on
volatile assets) of the interest borrowers pay. It is the Aave/Compound
standard, it is *already implemented* in the contract's rate math
(`reserve_factor_bps`), and it collects in aggregate — the borrow index grows
faster than the supply index and the wedge accrues to the protocol — without
ever deanonymizing a user. Illustratively, revenue runs **~0.5–1.0% of TVL per
year**, putting order-of-magnitude break-even near **~$10M TVL** for lean solo
operation (see WHITEPAPER.md §16 for the scenario math). Origination fees, a
liquidation-bounty cut, and the latent repay-retention are marginal or fight
the design and are not the plan.

**This revenue model is conditional on a legal gate that may fail.** The
money-transmitter question (§9) is a **first-order go/no-go, evaluated before
any audit or ceremony spend** — not a late-stage checkbox. A fee-taking,
single-operator privacy pool is the Tornado Cash silhouette; the honest reading
is that the current structure is presumptively non-viable for a US-touching
mainnet. One of the two resolving forks — *credibly-neutral, fee-less,
decentralized from day one* — **eliminates this revenue model entirely**,
leaving grants, ecosystem funding, or an unproven user-consented viewing-key
primitive. The other — *licensed/regulated entity* — preserves the model but
costs more than the fee it unlocks at any plausible Stellar TVL. Which fork is
taken is unresolved (BR2, OQ-4) and gates everything below.

**Two deliberate business decisions (if the fee-taking fork survives the legal
gate).** (1) **No token** — route fees to a treasury-owned position, because a
token stacks securities-law exposure on top of the money-transmitter exposure a
fee-taking privacy protocol already carries (§9). (2) **Fees are the last thing
switched on** — the legal determination comes first, then fees are designed,
tested on testnet during the audit stage, and activated only at mainnet
(reserve factor first, likely after a fee holiday so the anonymity set grows
before it is taxed). Note precisely what exists today: `reserve_factor_bps`
only *lowers* supplier yield in the rate math — no protocol-owned position
captures the wedge, so **revenue capture is not built**; a treasury sink is
net-new code. Until that mainnet decision, and only if the legal gate permits a
fee, Stellar Shield captures no value by design. See OQ-4.

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
  data on a fresh device (bounded by a data-retention window).
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
| BR2 | **Regulatory exposure of privacy pools.** The Tornado Cash precedent is genuine, not theoretical, and cuts both ways. OFAC sanctioned the Tornado Cash smart contracts on **2022-08-08** [S11]; the Fifth Circuit ruled in **Nov 2024** that OFAC overstepped (immutable contracts are not "property" under IEEPA) and Treasury **delisted** the addresses on **2025-03-21** [S15, S16] — a partial legal reprieve for the *contracts*. But developer liability remains live: co-founder Roman Storm was **convicted on 2025-08-06** of conspiracy to operate an unlicensed money-transmitting business (jury deadlocked on the money-laundering and sanctions-violation counts) [S17]. The lesson for a single-developer privacy protocol is that code being lawful does not shield the *operator* from money-transmission liability. | Regulatory/legal | Could make mainnet deployment legally unviable or personally risky for the developer. | A documented legal position — covering money-transmitter status, not just sanctions — is a *gating input* to any mainnet decision, not a post-launch add-on (OQ-3). |
| BR3 | **Privacy that isn't yet private.** At testnet volume the anonymity set is effectively zero, so positions are correlatable despite the cryptography. If launched prematurely, the product would over-promise. | Product credibility | Reputational damage; users assume privacy they don't have. | Do not market as privacy-delivering until anonymity-set KPI (§8) is met. |
| BR4 | **Single-developer execution capacity.** A lending protocol demands audit-grade rigor across cryptography, smart contracts, oracle integration, and in-browser proving — currently held by one person. | Execution | The system must not custody real value under this model; velocity and bus-factor are constrained. | Keep on testnet; mainnet requires additional people and independent audit. |
| BR5 | **Sole oracle dependency.** Pricing depends entirely on a single oracle provider — Reflector, a SEP-40-compliant Stellar price oracle run as a P2P consensus of ecosystem-operated nodes [S18]. It is real and widely used Stellar infrastructure (its V3 contract was audited via Code4rena in Oct 2025 [S18]), and SEP-40 is an established interface with multiple providers (e.g. RedStone adopted it in 2026 [S19]) — so the *interface* is not a lock-in, but Stellar Shield currently wires to one feed. | Operational | An oracle outage, mispricing, or discontinuation directly threatens solvency and availability. | Interface is SEP-40-standard and swappable in principle; a cross-checked fallback source is a mainnet prerequisite. |
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

---

## Sources

All URLs accessed **2026-07-13**. Crypto figures are point-in-time and move
fast; each is date-stamped in-text with "as of / by <date>." Figures are drawn
from the cited pages; where a primary dashboard (e.g. DefiLlama) could not be
fetched directly, the figure is taken from reporting that attributes it to that
dashboard, and this is noted. Nothing here is this product's own traction (§2,
v2.1 note).

| ID | Claim it supports | Source | URL |
|----|-------------------|--------|-----|
| S1 | Stellar DeFi TVL crossed $200M (~$197.4M on 2026-04-24); Blend ~$110M; Aquarius ~$51.69M — attributed to DefiLlama | MEXC News / cryptonews (reporting DefiLlama figures) | https://www.mexc.com/news/1055149 · https://cryptonews.net/news/altcoins/32925950/ |
| S2 | Stellar TVL under $12M (Nov 2024), ~$46M (May 2025), ~284% YoY 2025; RWA-led | Stellar chain page / cryptonews | https://defillama.com/chain/stellar · https://cryptonews.net/news/altcoins/32760427/ |
| S3 | Protocol 22 live on mainnet 2024-12-05; CAP-0059 BLS12-381 host functions | Stellar — "Announcing Protocol 22" | https://stellar.org/blog/developers/announcing-protocol-22 |
| S4 | CAP-0059 host functions for BLS12-381 (technical spec) | stellar-protocol CAP-0059 | https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md |
| S5 | 54 projects in Soroban Security Audit Bank (Feb 2026); 160+ funded via adoption fund | Stellar Audit Bank / State of Stellar Q1 2026 (Messari) | https://stellar.org/audit-bank/projects · https://messari.io/report/state-of-stellar-q1-2026 |
| S6 | DeFi lending ~$54B deposits (Apr 2026); Aave V3 ~$19.4B; 380+ protocols / 80+ chains | DefiLlama — lending category | https://defillama.com/protocols/lending |
| S7 | Aave scale / lending category detail | DefiLlama — Aave protocol | https://defillama.com/protocol/aave |
| S8 | Aave grew ~$8B (early 2024) → $40B+ (Aug 2025) | Yahoo Finance (reporting Aave TVL record) | https://finance.yahoo.com/news/aave-reaches-41-1-billion-221555507.html |
| S9 | Zcash ~$9–9.5B mcap (May 2026); >30% supply (>4.9M ZEC) shielded; 59.3% shielded tx (Feb 2026), up from ~8% early 2024 | crypto.news (shielded pool) / CoinGecko | https://crypto.news/why-30-of-zcash-supply-is-now-in-the-shielded-pool/ · https://www.coingecko.com/en/coins/zcash |
| S10 | Ethereum cumulative MEV >$1.8B by mid-2025 ($40–60M/mo); >50% high-value tx via private channels; privacy as institutional barrier | Cahill "Crypto Dark Pools" / COTI (Flashbots & Blocknative data cited) | https://static.cahill.com/docs/Crypto%20Under%20the%20Hood%20-%20The%20Case%20for%20Crypto%20Dark%20Pools%20or%20Not.pdf · https://cotinetwork.medium.com/private-defi-has-arrived-how-privacy-will-prevent-front-running-and-unlock-institutional-liquidity-e0b50fffc6e5 |
| S11 | Tornado Cash OFAC sanctions 2022-08-08; ~$460.6M TVL at sanction; >$7B total volume | TRM Labs / Paul Hastings crypto tracker | https://www.trmlabs.com/resources/blog/tornado-cash-volume-dramatically-reduced-post-sanctions-but-illicit-actors-are-still-using-the-mixer · https://www.paulhastings.com/insights/crypto-policy-tracker/a-whirlwind-of-change-the-delisting-of-tornado-cash |
| S12 | Tornado Cash peak TVL ~$1.17B (Oct 2021); ~60% TVL drop post-sanction | Stelareum / Nefture Security | https://www.stelareum.io/en/defi-tvl/protocol/torn.html · https://medium.com/nefture/after-the-ban-tornado-cash-6-months-on-5e5968390b00 |
| S13 | Stellar ~10.1M addresses, 5.1B operations, $33.9B RWA payment volume since 2015 | Stellar — Soroban page | https://stellar.org/soroban |
| S14 | Aztec Connect sunset (sequencer stopped 2024-03-31); decentralization cited as reason | Aztec Labs — "Sunsetting Aztec Connect" | https://medium.com/aztec-protocol/sunsetting-aztec-connect-a786edce5cae |
| S15 | Fifth Circuit (Nov 2024): OFAC overstepped; immutable contracts not "property" under IEEPA | BakerHostetler / Fifth Circuit opinion 23-50669 | https://www.bakerlaw.com/insights/victory-for-tornado-cash-as-court-rules-sanctions-were-unlawful/ · https://www.ca5.uscourts.gov/opinions/pub/23/23-50669-CV0.pdf |
| S16 | OFAC delisted Tornado Cash addresses 2025-03-21 | Venable / Paul Hastings | https://www.venable.com/insights/publications/2025/04/a-legal-whirlwind-settles-treasury-lifts-sanctions |
| S17 | Roman Storm convicted 2025-08-06 (unlicensed money transmitting); jury deadlocked on laundering & sanctions counts | Mayer Brown / Hodder Law | https://www.mayerbrown.com/en/insights/publications/2025/08/the-tornado-cash-trials-mixed-verdict-implications-for-developer-liability · https://hodder.law/roman-storm-tornado-cash-verdict-crypto-developers/ |
| S18 | Reflector = SEP-40 oracle, P2P node consensus; V3 audited via Code4rena (Oct 2025) | Reflector docs / Code4rena | https://reflector.network/docs · https://code4rena.com/audits/2025-10-reflector-v3 |
| S19 | SEP-40 is a multi-provider standard (RedStone adopted it, 2026) | RedStone blog | https://blog.redstone.finance/2026/06/04/reliability-at-scale-redstone-and-the-data-standard-for-stellars-rwa-moment/ |

**Verification note.** The DefiLlama Stellar chain dashboard (S1/S2) returned
HTTP 403 to automated fetch on 2026-07-13, so its live figure could not be pulled
first-hand; the $197.4M / $200M and historical TVL figures are taken from
reporting that explicitly attributes them to DefiLlama. Treat them as
"reported-as-of" rather than independently re-pulled. Stellar network totals
(S13) are self-reported by the Stellar Development Foundation. All other figures
are from the cited pages as accessed.
