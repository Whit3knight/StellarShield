pragma circom 2.1.9;

// Shielded pool liquidate circuit — v2 (Track A).
//
// Drops the sk-nullifier binding from the v1 circuit. A service
// worker holding only the memo openings (never the borrower's sk)
// can generate this proof. Contract wraps the verifier with a
// storage lookup: the loan_nullifier is pre-published in the
// LoanNullifier(loan_commitment) sidecar at borrow-time and
// cross-checked outside the circuit.
//
// Public signals order:
//   [0] borrow_amount_commit          from LiquidationBond
//   [1] collateral_value_commit       from LiquidationBond
//   [2] borrow_price_commit           from LiquidationBond
//   [3] current_price                 oracle-supplied, freshness enforced on chain
//   [4] threshold_bps                 must match risk_params.liquidation_threshold_bps
//
// Private witness:
//   loan_amount, bond_salt_amount           borrow_amount_commit opening
//   collateral_notional, bond_salt_value    collateral_value_commit opening
//   borrow_price, bond_salt_price           borrow_price_commit opening

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template LiquidateV2() {
    // Public.
    signal input borrow_amount_commit;
    signal input collateral_value_commit;
    signal input borrow_price_commit;
    signal input current_price;
    signal input threshold_bps;

    // Private.
    signal input loan_amount;
    signal input bond_salt_amount;
    signal input collateral_notional;
    signal input bond_salt_value;
    signal input borrow_price;
    signal input bond_salt_price;

    // 1. Reconstruct + assert the 3 bond commitments.
    component bondAmount = Poseidon(2);
    bondAmount.inputs[0] <== loan_amount;
    bondAmount.inputs[1] <== bond_salt_amount;
    bondAmount.out === borrow_amount_commit;

    component bondValue = Poseidon(2);
    bondValue.inputs[0] <== collateral_notional;
    bondValue.inputs[1] <== bond_salt_value;
    bondValue.out === collateral_value_commit;

    component bondPrice = Poseidon(2);
    bondPrice.inputs[0] <== borrow_price;
    bondPrice.inputs[1] <== bond_salt_price;
    bondPrice.out === borrow_price_commit;

    // 2. Underwater inequality — identical math to v1.
    signal lhs_partial;
    signal lhs;
    signal rhs_partial;
    signal rhs;
    lhs_partial <== loan_amount * threshold_bps;
    lhs         <== lhs_partial * borrow_price;
    rhs_partial <== collateral_notional * current_price;
    rhs         <== rhs_partial * 10000;

    component underwater = GreaterThan(200);
    underwater.in[0] <== lhs;
    underwater.in[1] <== rhs;
    underwater.out === 1;
}

component main {public [
    borrow_amount_commit,
    collateral_value_commit,
    borrow_price_commit,
    current_price,
    threshold_bps
]} = LiquidateV2();
