# Lifecycle demo walkthrough

End-to-end script covering deposit → borrow → claim OR repay →
withdraw. Run against the canonical testnet contract
(`CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ`) or a
fresh one you spun up per `docs/deployment.md`.

Liquidation (§4b) is currently **not demoable** — the underwater proof
is dimensionally inert and fails closed. Do not put it in a live demo.

## Setup

- Two Freighter accounts on the same testnet, both funded via
  friendbot / `stellar keys fund`.
- Env: `bun install && bun run dev` — the app at `http://localhost:3000`
  reads `.env.local` for the contract id.
- (Optional, for the liquidation service half) `LIQUIDATION_SERVICE_SK`
  seeded to match the on-chain `liquidation_service_pk`. Generate with
  `bun run gen:service-key`.

## 1. Borrower A: deposit collateral

1. Open the app in browser A, connect Freighter, unlock the shielded
   drawer.
2. On the target collateral asset (XLM by default — cheapest), click
   Deposit four times to mint 4 × 1 XLM shielded notes (`DENOMINATION`
   is raw units: `XLM: 10_000_000`, `USDC`/`EURC: 5_000_000` = 0.5).
   Freighter signs once per note.
3. Wait for the scanner pass — each fresh note appears in the list
   with a `#index` badge and a masked amount (PrivateValue).

## 2. Borrower A: open a shielded borrow

1. When 4 collateral notes accumulate, the `Borrow shielded` panel
   surfaces a `collateral → borrow` button per viable pair.
2. Click e.g. `XLM → USDC`. First borrow takes ~15-30 s while snarkjs
   downloads the borrow zkey; subsequent borrows are faster.
3. Freighter signs `borrow_shielded`. On confirm the collateral
   nullifiers land and one fresh loan note appears on the loan tree
   with:
   - `HF ~200%` badge (green, well above threshold)
   - `openedAt` age badge (< 1 min)
4. Click **Claim** on the loan note — Freighter signs
   `withdraw_loan_shielded`; the loan amount arrives in the connected
   wallet as native tokens.

**Claim and Repay are mutually exclusive, not sequential.** Both spend
the same loan nullifier `Poseidon(sk, loan_index)`
(`withdraw.circom:102-105` and `repay.circom:113-116`, both recorded in
the contract's `loan_nullifier_used` set), so a claimed loan can never
be repaid. Pick one branch per loan: do step 4 **or** §4a, not both.

## 3. Borrower A OR service: monitor

- Watchlist mode (any observer):
  ```bash
  bun run scan:underwater
  ```
  Prints the bond with age; no HF, no openings — bond commitments are
  opaque without decryption.

- Authenticated (service operator with the sk that matches the
  on-chain `liquidation_service_pk`):
  ```bash
  LIQUIDATION_SERVICE_SK=0x<sk_hex> bun run scan:underwater
  ```
  Decrypts the memo, fetches current Reflector price, computes the
  same underwater inequality the liquidate circuit enforces. Prints
  HF ratio + flags underwater bonds with `**`.

## 4a. Path A — repay

Requires an **unclaimed** loan note — skip step 2.4 to reach this path.

1. Borrower A deposits an extra note in the loan asset ≥ loan amount
   (with Track D interest, ≥ loan_amount × index_now / index_at_open).
2. The `Repay` button appears on the loan-note row once a viable
   deposit note is present.
3. Click Repay. Freighter signs `repay_shielded`; both nullifiers
   burn, the loan disappears from inventory.

## 4b. Path B — liquidate (NOT CURRENTLY REACHABLE)

**This path cannot be demoed today.** The v1/v2 underwater inequality
compares a `1e14`-scaled `collateral_notional` against an unscaled loan
side, so witness generation fails for every position no matter how far
the price moves (`shielded-liquidate-v2/src/liquidate_v2.circom:59-72`).
Both call sites additionally skip when Reflector has no feed — see the
`ponytail:` comments in `features/shielded-pool/use-liquidate.ts` and
`contracts/scripts/scan-underwater.ts`. Fixing it needs a v3 circuit
with an explicit divisor and a contract-read price.

The steps below describe the intended flow once v3 lands; they will not
complete against the current deployment.

1. HF badge turns destructive on the loan note. The `Liquidate`
   button appears.
2. Click Liquidate. Depending on the bond version:
   - Post-Track-A bond (LoanNullifier sidecar present) → runs
     `shielded-liquidate-v2` prover + `liquidate_shielded_v2` fn.
     Any wallet holding the memo openings can trigger.
   - Pre-Track-A bond → falls back to sk-binding `shielded-liquidate`
     circuit + `liquidate_shielded` fn. Only the borrower can
     self-liquidate.
3. On confirm:
   - Loan nullifier posted, loan note vanishes from borrower A's
     inventory.
   - A fresh deposit note of 1 × collateral denomination lands in the
     liquidator's inventory as the bounty (C-simple flat payout).

## 5. Borrower B (liquidator): claim bounty

1. Refresh the drawer or wait for the next scanner pass. The bounty
   deposit note appears with a fresh `#index`.
2. Click Withdraw. The standard `withdraw_shielded` circuit checks
   `amount === denomination(asset)`; the note redeems for the fixed
   denomination in the collateral asset.

## 6. Verify

- Contract state after each step via the CLI:
  ```bash
  stellar contract invoke --network testnet \
    --id CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ -- \
    total_deposit --asset XLM
  stellar contract invoke --network testnet \
    --id CCNLBMUTHMO5SXRBJ5DIKZDSS3J3OEW4PB5UFWATEXWLEDBGOBIEAEIZ -- \
    total_borrow --asset USDC
  ```
- Everything is on-chain reproducible: reset the browser localStorage
  and reconnect Freighter — the scanner rebuilds the same note
  inventory from encrypted memos alone.

## Time budget

| Step | Wall clock |
| --- | --- |
| Deposit × 4 | ~2 min (mostly Freighter clicks) |
| Borrow prove + sign | ~30 s (first) / ~10 s (cached zkey) |
| Claim loan | ~15 s |
| Repay OR liquidate + prove + sign | ~15 s |
| Bounty withdraw | ~10 s |

Full lifecycle: ~5 min end-to-end after wallets + env are ready.
