pragma circom 2.1.9;

// Stellar Shield borrow-eligibility circuit — Circom edition.
//
// Same semantics as the Noir variant in
// ../borrow-eligibility/src/main.nr but rebuilt as an R1CS/Groth16
// circuit over BN254 so it lines up with the Nethermind/SDF Soroban
// Groth16 verifier.
//
// Unit convention: whole asset units (integer XLM / USDC), same as the
// Noir side. Contract cross-checks intent stroops → whole units before
// comparing to proof public inputs.

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Basis-point scale (1/10000).
template BorrowEligibility() {
    // ---- Public inputs (bind proof to intent context) ----
    signal input account;
    signal input market;
    signal input proof_id;
    signal input collateral_symbol;
    signal input borrow_symbol;
    signal input collateral_amount;
    signal input borrow_amount;
    signal input hf_min_bps;
    signal input max_ltv_bps;
    signal input oracle_epoch;

    // ---- Private witness ----
    signal input oracle_price;
    signal input oracle_price_salt;
    signal input raw_collateral_balance;

    // ---- Public output ----
    signal output oracle_price_commitment;

    // Range-check every amount at 64 bits so downstream mul stays bounded.
    component collAmtRange = Num2Bits(64);
    collAmtRange.in <== collateral_amount;
    component borrowAmtRange = Num2Bits(64);
    borrowAmtRange.in <== borrow_amount;
    component priceRange = Num2Bits(64);
    priceRange.in <== oracle_price;
    component rawBalRange = Num2Bits(64);
    rawBalRange.in <== raw_collateral_balance;

    // 1. Prover actually holds enough collateral.
    component enoughCollateral = GreaterEqThan(64);
    enoughCollateral.in[0] <== raw_collateral_balance;
    enoughCollateral.in[1] <== collateral_amount;
    enoughCollateral.out === 1;

    // 2. Positive amounts.
    component collateralPositive = GreaterThan(64);
    collateralPositive.in[0] <== collateral_amount;
    collateralPositive.in[1] <== 0;
    collateralPositive.out === 1;

    component borrowPositive = GreaterThan(64);
    borrowPositive.in[0] <== borrow_amount;
    borrowPositive.in[1] <== 0;
    borrowPositive.out === 1;

    // 3. Health factor: collateral_value * BPS >= hf_min_bps * borrow_amount.
    // Rewritten as multiplied comparison so we skip division inside R1CS.
    signal collateral_value <== collateral_amount * oracle_price;
    signal hf_lhs <== collateral_value * 10000;
    signal hf_rhs <== hf_min_bps * borrow_amount;

    component hfCheck = GreaterEqThan(128);
    hfCheck.in[0] <== hf_lhs;
    hfCheck.in[1] <== hf_rhs;
    hfCheck.out === 1;

    // 4. LTV: borrow_amount * BPS <= max_ltv_bps * collateral_value.
    signal ltv_lhs <== borrow_amount * 10000;
    signal ltv_rhs <== max_ltv_bps * collateral_value;

    component ltvCheck = LessEqThan(128);
    ltvCheck.in[0] <== ltv_lhs;
    ltvCheck.in[1] <== ltv_rhs;
    ltvCheck.out === 1;

    // 5. Bind the remaining public inputs into a hash we return as
    // public output. Poseidon over BN254 fits R1CS cheaply; the
    // commitment doubles as the oracle price binding.
    component commit = Poseidon(6);
    commit.inputs[0] <== oracle_price;
    commit.inputs[1] <== oracle_price_salt;
    commit.inputs[2] <== account;
    commit.inputs[3] <== market;
    commit.inputs[4] <== proof_id;
    commit.inputs[5] <== oracle_epoch;

    // Also touch collateral_symbol + borrow_symbol so they cannot be
    // stripped from the verifier's public input vector.
    signal symbol_bind <== collateral_symbol + borrow_symbol;
    oracle_price_commitment <== commit.out + symbol_bind;
}

// Phase-1 privacy: amounts move out of the public inputs list. Circuit
// still constrains them (private witness) — chain no longer sees the
// raw borrow_amount / collateral_amount.
component main {public [
    account,
    market,
    proof_id,
    collateral_symbol,
    borrow_symbol,
    hf_min_bps,
    max_ltv_bps,
    oracle_epoch
]} = BorrowEligibility();
