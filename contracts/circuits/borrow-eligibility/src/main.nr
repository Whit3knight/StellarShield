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
//
// Unit convention: the circuit works in **whole asset units** (integer
// XLM / integer USDC), not stroops. `oracle_price` is a whole-number
// exchange rate. Contract-side stroop amounts must be divided down
// (or the intent's whole-unit view fed) before cross-checking against
// the proof's public inputs.
//
// Rationale: bb.js 5.0.0-nightly UltraHonk does not yet support u128
// ACIR opcodes cleanly (bare u128 mul triggers a WASM `unreachable`
// panic in Barretenberg). Skeleton stays u64 with reduced scale; when
// bb ships u128 support, restore stroop-precision inputs.

// Basis points (1/10000).
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

    // 3. Health factor: collateral_value * BPS >= hf_min_bps * borrow_amount.
    // Multiplied form dodges u64 division opcodes which some bb.js
    // UltraHonk builds reject at runtime.
    let collateral_value: u64 = collateral_amount * oracle_price;
    assert(collateral_value * BPS >= hf_min_bps * borrow_amount);

    // 4. LTV: borrow_amount * BPS <= max_ltv_bps * collateral_value.
    assert(borrow_amount * BPS <= max_ltv_bps * collateral_value);

    // 5. Bind public inputs into the return value so bb can't strip
    // them from the verifier key. Sum-into-return is a lightweight
    // way to reference every binding once without emitting trivial
    // `x == x` constraints (which some bb.js UltraHonk builds trip
    // on with `RuntimeError: unreachable`).
    let bindings_sum: Field = account
        + market
        + proof_id
        + collateral_symbol
        + borrow_symbol
        + oracle_epoch as Field;

    // 6. Oracle price commitment as public output. Trivial addition
    // for skeleton; swap for a real hash once bb.js UltraHonk supports
    // the desired primitive cleanly.
    let price_field = oracle_price as Field;
    price_field + oracle_price_salt + bindings_sum
}

#[test]
fn happy_path() {
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 500, 20_000, 6_300, 42,
        2, 0xdeadbeef,
        1_000,
    );
}

#[test(should_fail)]
fn rejects_underfunded_borrower() {
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 500, 20_000, 6_300, 42,
        2, 0x1,
        500,
    );
}

#[test(should_fail)]
fn rejects_hf_below_min() {
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 900, 20_000, 6_300, 42,
        1, 0x1,
        1_000,
    );
}

#[test(should_fail)]
fn rejects_ltv_above_max() {
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        1_000, 800, 10_000, 6_300, 42,
        1, 0x1,
        1_000,
    );
}

#[test]
fn realistic_whole_units() {
    // 3_000 XLM collateral, 220 USDC borrow, price = 1 USDC per XLM.
    // value = 3_000; hf_bps = 3_000 * 10_000 / 220 = 136_363
    // ltv_bps = 220 * 10_000 / 3_000 = 733
    let _ = main(
        0x01, 0x02, 0x03, 0x04, 0x05,
        3_000, 220, 12_500, 6_300, 1_720_000_000,
        1, 0xcafebabe,
        3_000,
    );
}
