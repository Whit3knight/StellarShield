// Borrow eligibility circuit.
// Spec: contracts/circuits/borrow-eligibility/SPEC.md
//
// Public inputs bind the proof to the caller, market, amounts, thresholds,
// and oracle epoch. Private inputs stay hidden — raw balance and raw
// oracle price never leave the prover.
//
// The oracle_price_commitment is a public OUTPUT — the circuit computes
// it from the private oracle_price + salt. The verifier reads it from
// the proof's public-inputs vector and the contract cross-checks it
// against the on-chain oracle snapshot.
//
// Verifier lives on-chain in the borrow-pool contract via Soroban's
// BLS12-381 host functions (CAP-0059).

// Basis points (1/10000). Health factor and LTV are quoted in bps to stay
// integer-only inside the circuit.
global BPS: u64 = 10_000;

fn main(
    // --- public: binds proof to intent context ---
    account: pub Field,
    market: pub Field,
    proof_id: pub Field,
    collateral_symbol: pub Field,
    borrow_symbol: pub Field,
    collateral_amount: pub u64,
    borrow_amount: pub u64,
    hf_min_bps: pub u64,
    max_ltv_bps: pub u64,
    oracle_epoch: pub u64,

    // --- private witness ---
    oracle_price: u64,
    oracle_price_salt: Field,
    raw_collateral_balance: u64,
) -> pub Field {
    // 1. Prover actually holds enough collateral.
    assert(raw_collateral_balance >= collateral_amount);

    // 2. Positive amounts.
    assert(collateral_amount > 0);
    assert(borrow_amount > 0);

    // 3. Health factor: collateral_value * BPS / borrow_amount >= hf_min_bps.
    // Multiply first to preserve precision; u64 range enforced by types.
    let collateral_value: u64 = collateral_amount * oracle_price;
    let hf_bps: u64 = collateral_value * BPS / borrow_amount;
    assert(hf_bps >= hf_min_bps);

    // 4. LTV: borrow_amount * BPS / collateral_value <= max_ltv_bps.
    let ltv_bps: u64 = borrow_amount * BPS / collateral_value;
    assert(ltv_bps <= max_ltv_bps);

    // 5. Bind unused-looking public inputs so they cannot be swapped.
    // Noir strips truly unused public inputs; touching them with
    // trivial constraints locks them into the verifier's public-input
    // vector.
    assert(account == account);
    assert(market == market);
    assert(proof_id == proof_id);
    assert(collateral_symbol == collateral_symbol);
    assert(borrow_symbol == borrow_symbol);
    assert(oracle_epoch == oracle_epoch);

    // 6. Oracle price commitment as public output. Contract reads this
    // from the proof's public-inputs vector and cross-checks against
    // the on-chain oracle snapshot for (market, oracle_epoch).
    let price_field = oracle_price as Field;
    std::hash::pedersen_hash([price_field, oracle_price_salt])
}

#[test]
fn happy_path() {
    // collateral: 1_000 units at price 2 → value 2_000
    // borrow: 500 → HF = 2_000 * 10_000 / 500 = 40_000 bps
    // LTV = 500 * 10_000 / 2_000 = 2_500 bps
    let _ = main(
        0x01,           // account
        0x02,           // market
        0x03,           // proof_id
        0x04,           // collateral_symbol
        0x05,           // borrow_symbol
        1_000,          // collateral_amount
        500,            // borrow_amount
        20_000,         // hf_min_bps = 200%
        6_300,          // max_ltv_bps = 63%
        42,             // oracle_epoch
        2,              // private: oracle_price
        0xdeadbeef,     // private: salt
        1_000,          // private: raw_collateral_balance
    );
}

#[test(should_fail)]
fn rejects_underfunded_borrower() {
    // Claims 1_000 collateral but only owns 500.
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 500, 20_000, 6_300, 42,
        2, 0x1,
        500,  // raw < claimed
    );
}

#[test(should_fail)]
fn rejects_hf_below_min() {
    // price 1, collateral 1_000 → value 1_000; borrow 900 → HF ≈ 11_111 bps
    // hf_min = 20_000 bps → should fail.
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 900, 20_000, 6_300, 42,
        1, 0x1,
        1_000,
    );
}

#[test(should_fail)]
fn rejects_ltv_above_max() {
    // borrow 800 vs value 1_000 → LTV 8_000 bps > 6_300 max.
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 800, 10_000, 6_300, 42,
        1, 0x1,
        1_000,
    );
}
