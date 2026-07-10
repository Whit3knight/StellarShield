# Borrow Eligibility Circuit Spec

Zero-knowledge circuit proving a borrower meets health-factor and LTV
thresholds for a Stellar Shield borrow intent, without leaking raw
balances or oracle-derived collateral value.

Prover stack: **Noir + Barretenberg (Groth16 over BLS12-381)**.
On-chain verifier: Soroban BLS12-381 host functions (Protocol 22+, CAP-0059).

## Statement

The prover claims: "I own an account whose collateral, valued at the
market's committed oracle price for epoch `oracle_epoch`, yields a
health factor ≥ `hf_min_bps` and an LTV ≤ `max_ltv_bps` for a borrow of
`borrow_amount` of `borrow_symbol` against `collateral_amount` of
`collateral_symbol`. This proof is bound to `proof_id`, `account`,
`market`, and cannot be replayed."

## Public inputs

| Name | Type | Bind purpose |
|---|---|---|
| `account` | Field (address hash) | Ties proof to caller; contract checks match `require_auth()` |
| `market` | Field (symbol hash) | Ties proof to specific market |
| `proof_id` | Field (32-byte digest) | Contract replay guard |
| `collateral_symbol` | Field | Verifier + contract cross-check |
| `collateral_amount` | Field (i128 → Field) | Verifier + contract cross-check |
| `borrow_symbol` | Field | Verifier + contract cross-check |
| `borrow_amount` | Field (i128 → Field) | Verifier + contract cross-check |
| `hf_min_bps` | Field (u32) | Policy threshold |
| `max_ltv_bps` | Field (u32) | Policy threshold |
| `oracle_epoch` | Field (u64) | Staleness bound; contract rejects epoch older than `now - MAX_ORACLE_AGE` |
| `oracle_price_commitment` | Field (poseidon hash) | Binds proof to specific oracle snapshot |

## Private inputs (witness)

| Name | Type | Notes |
|---|---|---|
| `oracle_price` | Field | Raw oracle price; hashed into `oracle_price_commitment` |
| `oracle_price_salt` | Field | Blinding for commitment |
| `raw_collateral_balance` | Field | Actual on-account balance (≥ `collateral_amount`) |

## Constraints

1. `poseidon2([oracle_price, oracle_price_salt]) == oracle_price_commitment`
2. `raw_collateral_balance ≥ collateral_amount`
3. `collateral_amount > 0`
4. `borrow_amount > 0`
5. `collateral_value = collateral_amount * oracle_price` (bounded mul, overflow-checked)
6. `hf_bps = collateral_value * 10_000 / borrow_amount`
7. `hf_bps ≥ hf_min_bps`
8. `ltv_bps = borrow_amount * 10_000 / collateral_value`
9. `ltv_bps ≤ max_ltv_bps`
10. Range check every field-encoded integer against its declared bit width.

## Out of scope for the circuit

- Actual token transfer authorization (contract handles via `require_auth`).
- Multi-collateral positions (single collateral per proof; extend later).
- Interest accrual or dynamic rate (contract responsibility).
- Oracle authenticity (contract cross-checks `oracle_price_commitment`
  against a signed oracle attestation stored on-chain; commitment scheme
  documented separately).

## Contract cross-checks

Contract MUST verify, before accepting a proof:

- `account` public input == `env.current_contract_invoker()` /
  authenticated caller.
- `market`, `collateral_symbol`, `collateral_amount`, `borrow_symbol`,
  `borrow_amount` match the `BorrowIntent` fields.
- `oracle_epoch` within `MAX_ORACLE_AGE` (e.g., 60 s) of `env.ledger().timestamp()`.
- `oracle_price_commitment` == the current committed oracle snapshot
  for that market and epoch (oracle contract lookup — deferred).
- `hf_min_bps` and `max_ltv_bps` meet or beat the market's on-chain
  policy floor (contract rejects weaker thresholds).
- `proof_id` unseen (existing replay guard).

Missing any check silently accepts a valid-but-stale or valid-but-wrong-account
proof. All checks non-negotiable at audit.

## Failure modes to fuzz in audit

- Prover submits proof for account A, borrower is account B → account bind must reject.
- Prover replays proof with different amounts → amount public inputs must reject.
- Prover uses stale oracle → epoch bound + commitment mismatch must reject.
- Prover under-collateralised at witness time → constraint 2 fails during proof gen (no proof produced).
- Prover crafts poseidon commitment collision → 2⁻¹²⁸ security assumed from Poseidon2; document acceptance.

## Freeze policy

Any change to this spec after Phase 6 audit start = re-audit gate.
