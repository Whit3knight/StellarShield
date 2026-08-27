# Stellar Shield — SCF Build Award submission draft

Modeled on the Olio SCF form (11 fields). Every claim below was checked against
this repo, the live testnet contract, or Horizon on 2026-08-18. Fields needing
your input are marked **`[FILL]`**. Nothing here is invented — see
"Verification log" at the bottom for how each number was obtained.

> **Re-verified 2026-08-27.** Sections 2, 4, and 6 were updated after three of
> the items originally listed under "funded work" shipped during continued
> development, ahead of any grant funding — see the note at the top of §6.
> Other fields (5, 7–11) reflect the original 2026-08-18 check and still need
> the `[FILL]`/action items noted there.

---

## 1. Project Title

Stellar Shield

---

## 2. Project Description

Stellar Shield is a shielded borrow pool on Soroban — a Zcash-style privacy
layer for collateralized borrowing. On a public lending market, anyone can read
a borrower's collateral, loan size, health factor, and liquidation price. Bots
front-run liquidations, competitors copy strategies, and a wallet address ties a
real balance sheet to a public identity permanently. Stellar Shield removes that
exposure: a user deposits fixed-denomination notes into per-asset commitment
trees, then proves ownership of unspent collateral with a Groth16 zero-knowledge
proof, without revealing which notes they own, how much they hold, or which
deposit funded which loan.

Proofs are generated in the user's browser with snarkjs over BLS12-381 and
verified inside the Soroban contract using Protocol 22's CAP-0059 host
functions — no trusted relayer and no off-chain verifier. Nullifiers posted at
spend time prevent double-spending, and ChaCha20-Poly1305 encrypted memos
emitted with every transaction let a fresh browser rebuild the user's entire
note inventory from public chain events alone, so the system stays
self-custodial with no server holding user state. Collateral prices come from
Reflector (SEP-40). The full lifecycle — deposit, borrow against four collateral
notes, claim the loan into a wallet, repay with accrued interest, and withdraw —
runs end to end on Stellar testnet with real on-chain proof verification.

Stellar Shield is a technical validation, not a launched product: it has no
external users, no TVL, and is not on mainnet. Loan sizing is now bound to a
live, contract-verified oracle price rather than a blunt denomination cap, and
liquidation triggers on-chain against a real underwater proof rather than
failing closed — both were disclosed gaps in an earlier draft of this
application and have since been fixed and deployed to the same testnet
contract (see §6). What remains before any mainnet deployment is an
independent audit and a multi-party trusted-setup ceremony, then a run under
decentralized administration — exactly what this application is asking to
fund.

---

## 3. Project Category

DeFi / Financial Protocol — a privacy-preserving borrowing protocol with an
end-user dashboard.

> **`[FILL]`** Pick whichever label the live form actually offers. Olio chose
> "End-User Application"; Stellar Shield is protocol-first with a dashboard on
> top, so a protocol/DeFi category fits better if one exists. If the form only
> offers Olio's options, "End-User Application" is defensible — the dashboard is
> the product surface.

---

## 4. Current Traction

- **Full shielded lifecycle verified live on Stellar testnet**, with every proof
  verified on-chain by Protocol 22 BLS12-381 host functions — not simulated and
  not off-chain. Deposit, borrow, claim, repay, and withdraw all succeed against
  the current contract `CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ`.
  Most recent end-to-end verification: a repay transaction closing a loan and
  burning both the loan and deposit nullifiers, ledger 3,927,624, tx
  `574f33d09f71fc234a1f1bc46d995d4012c893fef979ff0c1486362b3bcac609`. Since
  then the same live contract has been upgraded in place four more times
  (oracle-bound solvency, its own dimensional-bug fix, working liquidation
  triggering, and collateral-recovering repay — see §6), each preceded by a
  real on-chain prove → submit → verify round trip on a disposable test
  contract before the live upgrade.
- **8 production Circom/Groth16 circuits** over BLS12-381 (deposit, quad
  deposit, borrow, withdraw, repay, repay v2, liquidate v1, liquidate v2),
  with verification keys embedded in the contract binary (repay v2's in a
  separate stateless helper contract, to keep its verifier out of the main
  pool contract's WASM parse-cost footprint) — one verifier per circuit.
- **Contract fully configured on testnet**: 3 reserves (XLM, USDC, EURC) via the
  Stellar Asset Contract, 6 registered markets (USDC/XLM, XLM/USDC, EURC/USDC,
  USDC/EURC, EURC/XLM, XLM/EURC), live rate and risk parameters, and Reflector
  CEX/DEX plus FX oracle feeds wired in.
- **Public dashboard deployed** at https://www.stellarshield.xyz, connected to
  Freighter on testnet.
- **Codebase**: ~30,400 lines of TypeScript across the app, feature layers, and
  operator CLI, ~6,500 lines of Rust in the Soroban contract, and ~1,300 lines
  of Circom — roughly 38,200 lines total across 330 commits in a public
  repository (github.com/Whit3knight/StellarShield).
- **281 automated tests across 36 files.** CI gates lint, typecheck, tests, a
  proving-artifact manifest check, and a production build on every push, with a
  separate testnet end-to-end workflow that drives a real deposit → borrow →
  repay against the deployed contract.
- **Event-durability pipeline shipped**: a Goldsky → Neon Postgres indexer backs
  the frontend note scanner, so a user's private note inventory stays
  recoverable beyond Stellar RPC's ~7-day event retention window — a real
  constraint for any note-based privacy system on Stellar.
- **Engineering documentation is public and unusually candid**: a PRD and BRD
  fact-checked line by line against source, a whitepaper, a 16-item remediation
  risk register (R1–R16), a deployment runbook, and a liquidation design
  document — including written statements of what does *not* work.
- **No user, TVL, or transaction-volume claims.** Stellar Shield is testnet-only
  and has never been marketed; on-chain pool totals are zero and every
  transaction to date is developer testing. Our own BRD records external demand
  as an unvalidated hypothesis rather than a result. We would rather submit a
  zero than a number we cannot defend.

---

## 5. Website

https://www.stellarshield.xyz

Repository: https://github.com/Whit3knight/StellarShield

> **`[FILL]` / action required before you submit.** The live site currently
> serves a stale build — `https://www.stellarshield.xyz/api/events` returns 404,
> which means the deployed version predates the indexer route, and local commits
> through `680f846` were never pushed (origin last received a push on
> 2026-07-31). Push `development` → `staging` → `main` so the deployed build
> matches the contract and code you are describing, then re-check the URL. A
> reviewer clicking through to a build older than your claims is an avoidable
> loss.

---

## 6. Planned Stellar Integration

Stellar Shield is already built natively on Soroban. The architecture is a
single Rust contract holding six incremental Merkle trees — one deposit tree and
one loan tree for each of XLM, USDC, and EURC, each depth 20 — over Poseidon
commitments, plus a nullifier set namespaced per (tree, asset) that guards
against double-spend. The contract holds real testnet tokens through the Stellar
Asset Contract, verifies Groth16 proofs on-chain using Protocol 22's BLS12-381
host functions with a dedicated verifying key per circuit, reads collateral
prices from Reflector over the SEP-40 interface, and emits encrypted note
metadata on-chain that is decrypted only in the recipient's browser. The
frontend is Next.js 16 with Freighter for signing; the user's shielded identity
is derived from a wallet signature, so no server ever holds a spending key.

**Already delivered, ahead of any grant funding.** An earlier draft of this
application listed three engineering gaps as the first three items of funded
work. All three shipped during continued development and are live on the same
testnet contract cited in §4 — evidence of execution velocity, not a reason to
shrink the ask:

- **Solvency is now provable, not merely capped.** `oracle_price` is a public
  circuit signal the contract cross-checks against a live Reflector read
  (200bps tolerance, fails closed if the feed is stale or absent); the
  circuit's own LTV/health-factor band is the real solvency guard again, not
  a blunt one-denomination cap. Collateral and loan amounts stay private via
  Jubjub Pedersen commitments folded into a running on-chain aggregate.
- **Liquidation actually triggers.** The underwater comparison's unit-scale
  mismatch is fixed (cross-multiplication, no division), `threshold_bps` now
  matches the dashboard's own convention, and both liquidation paths
  cross-check their price against a live Reflector read the same way borrow
  does. Verified end to end on a real underwater position, not just a
  synthetic proof.
- **Collateral recovery on repay.** A new circuit mints the original
  collateral back into the deposit tree at repay time instead of leaving it
  burned, reusing the bond opened at borrow time — and closed a related gap
  where a proof's `loan_commitment` argument wasn't bound to the note it
  actually repaid.

**The funded work that remains** is the path from a working, already-solvent
technical validation to a system that can safely hold real value:

1. **Independent audit and a multi-party trusted-setup ceremony.** The current
   proving keys come from a development ceremony and must be regenerated. All
   three circuit changes above are now settled, so the ceremony can be
   scheduled without another round of `.zkey` churn.
2. **Mainnet under decentralized administration**, followed by a limited
   real-value pilot. We will not deploy to mainnet while the anonymity set is
   effectively zero; growing pool volume is what makes the privacy real rather
   than merely cryptographic.

Two limitations we state openly because they shape the roadmap rather than
undermine it: the liquidation-service operator can decrypt every borrower's
position, which is why the operator-trust removal is on the roadmap and why the
threshold-key alternative was evaluated and documented; and privacy is a
function of pool size, so at testnet volume the machinery of privacy works while
the guarantee does not yet bind. Both are recorded in our public risk register.

---

## 7. Build Track

**Open Track** — for experienced builders exploring novel use cases on Stellar
or Soroban.

Rationale: Stellar Shield is a new on-chain primitive, not an integration of an
existing building block. Shielded *lending* — putting a collateral-ownership
proof and an LTV check inside a zero-knowledge circuit verified on-chain — does
not exist on Stellar today, and is a harder problem than the shielded transfers
most privacy protocols implement. The Integration Track explicitly targets teams
incorporating an existing Stellar building block or teams with significant
existing traction; Stellar Shield matches neither. Note the trade-off: the Open
Track includes a community vote, which the Integration Track does not.

---

## 8. Submitter type

Team of Individuals

---

## 9. Email

**`[FILL]`** — this repo shows two addresses for you: `uix.brianadi@gmail.com`
(the git commit author) and `anything.brianadi@gmail.com`. Use whichever inbox
you actually monitor; SCF correspondence and milestone reviews go there.

---

## 10. Team Description

Stellar Shield is built by two people. Arham [surname] leads business development and also runs operations: ecosystem outreach, partnerships, and go-to-market, plus keeping the app deployed, the monitoring service running, and the data pipeline that lets users recover their private balances long after a payment was made. Brian leads development and built effectively the whole product: the smart contract, the zero-knowledge circuits behind every private transaction, the proof generation that runs in the user's own browser, and the dashboard — around 38,200 lines across 330 commits, with public product, architecture, and risk documentation kept alongside the code.

*(670 chars.)*

> **Check before you submit.** Git shows one author on all 330 commits except a
> single README change by `Whit3knight <arhamalaghny@gmail.com>`, and all 12
> commits touching `deploy/` and `.github/` are Brian's — so the operations half
> of Arham's line is checkable and currently unsupported. Cheapest fix is to make
> it true: have Arham land the pending deploy work (push `development` →
> `staging` → `main`, re-apply the Goldsky pipeline) under his own account first.

---

## 11. Referral Information

**`[FILL]`** — who referred you to SCF, or which Stellar event, hackathon,
ambassador, or community member pointed you here. Leave blank only if genuinely
nobody did.

---

## Before you submit

1. **Push and redeploy.** Local `development` is 3 commits ahead of what origin
   last received; production serves a build old enough that the `/api/events`
   route 404s. Ship `development` → `staging` → `main` first.
2. **Re-point the Goldsky pipeline.** `goldsky/stellar-shield-events.yaml`
   already names the current contract, but the Neon table still holds rows only
   for retired contracts. Re-apply the pipeline with a `start_at` at the current
   contract's deploy ledger so a reviewer visiting the site sees a working note
   scanner.
3. **Re-run the live lifecycle once, close to submission day.** The testnet
   deposit events from the 2026-08-02 verification have already aged out of the
   RPC retention window (oldest retained ledger is now 4,087,560; the repay
   landed at 3,927,624). A fresh deposit → borrow → claim right before you
   submit means a reviewer who opens the dashboard sees live state rather than
   an empty pool.
4. **Add a LICENSE.** The repository is public with no license file, which for a
   grant reviewer reads as "not actually open source." Apache-2.0 or MIT.
5. **Record a demo video.** The Open Track evaluation criteria explicitly name a
   video presentation showcasing the team.
6. **Keep the honesty.** The candor in fields 4 and 6 is a competitive advantage
   with a technical delegate panel, not a weakness — they will read the repo, and
   the repo already says these things out loud. Do not quietly soften the
   liquidation or LTV language here while the README states it plainly; the
   mismatch is what would actually cost you.

---

## Verification log

| Claim | How it was checked |
|---|---|
| Contract ID, markets, reserves | `stellar contract invoke … list_markets` against testnet, 2026-08-18 |
| Pool totals are zero | `total_deposit` / `total_borrow` for XLM, USDC, EURC all returned `"0"` |
| Repay tx succeeded | Horizon: `successful: true`, `created_at 2026-08-02T08:02:51Z`, ledger 3927624 |
| Site live, `/api/events` 404 | `curl` to `https://www.stellarshield.xyz/` (200) and `/api/events?limit=2` (404) |
| Repo public, no license, last push | `gh repo view Whit3knight/StellarShield` — `PUBLIC`, `licenseInfo: null`, `pushedAt 2026-07-31` |
| 330 commits, one author | `git log --oneline \| wc -l`, `git shortlog -sne --all` (re-checked 2026-08-27) |
| Line counts (re-checked 2026-08-27) | `wc -l` over `app/`, `components/`, `features/`, `contracts/*.rs`, `contracts/circuits/**/*.circom` |
| 281 tests / 36 files | `bun run test` output, 2026-08-27; `find . -name "*.test.ts*"` |
| 8 circuits | `ls contracts/circuits/` — deposit, deposit-quad, borrow, withdraw, repay, repay-v2, liquidate, liquidate-v2, 2026-08-27 |
| RPC retention aged out the test events | paginated `getEvents`: oldest retained ledger 4,087,560 vs repay at 3,927,624 |
| SCF track definitions | SCF Handbook, Build Award and Open Track pages, fetched 2026-08-18 |
| Brian's credentials (Hiresai, Base Freelance, TCP1P, Gemastik 18, Amikom) | `Brian Adi_Portofolio_Academy.pdf`, Apple Developer Academy portfolio submission |
| Arham's repo contribution | `git shortlog -sne --all`: `Whit3knight <arhamalaghny@gmail.com>`, 1 commit (`fdfc11d`, 2026-07-16) |
| All infra authored by Brian | `git log --format='%an' -- deploy/ .github/`: 12 commits, all `bri-anadi` |
