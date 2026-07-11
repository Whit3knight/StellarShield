pragma circom 2.1.9;

// Shielded pool liquidation circuit (Track L phase 3).
//
// A liquidator holding the memo openings for an underwater loan proves,
// without revealing the borrower or the exact amounts, that:
//   1. `loan_commitment` opens under the private witness (sk, salt).
//   2. The 3 bond commitments pinned at borrow-time match the private
//      openings (loan_amount, collateral_notional, borrow_price).
//   3. The loan is underwater at the caller-supplied `current_price`:
//        loan_amount * threshold_bps * borrow_price
//         > collateral_notional * current_price * 10_000
//      Rearranged so both sides stay integer.
//   4. `loan_nullifier = Poseidon(sk, loan_index)` matches, so the
//      contract can burn the note atomically with the trigger.
//
// Contract cross-checks:
//   - `current_price` freshness via oracle epoch.
//   - `threshold_bps` matches its own risk_params.
//   - The 3 bond commitments match the stored LiquidationBond keyed by
//     `loan_commitment`.
//
// Public signals order:
//   [0] loan_commitment
//   [1] borrow_amount_commit
//   [2] collateral_value_commit
//   [3] borrow_price_commit
//   [4] current_price
//   [5] threshold_bps
//   [6] loan_nullifier
//
// Private witness:
//   sk                     borrower secret (leaked to service via memo)
//   loan_asset_tag         encoded in the loan commitment
//   loan_salt              blinding for the loan note
//   loan_index             tree position (for nullifier)
//   loan_amount            borrow_amount opening
//   bond_salt_amount       borrow_amount_commit opening
//   collateral_notional    collateral_value opening (loan-asset units)
//   bond_salt_value        collateral_value_commit opening
//   borrow_price           borrow_price_commit opening
//   bond_salt_price        borrow_price_commit opening

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template Liquidate() {
    // Public.
    signal input loan_commitment;
    signal input borrow_amount_commit;
    signal input collateral_value_commit;
    signal input borrow_price_commit;
    signal input current_price;
    signal input threshold_bps;
    signal input loan_nullifier;

    // Private.
    signal input sk;
    signal input loan_asset_tag;
    signal input loan_salt;
    signal input loan_index;
    signal input loan_amount;
    signal input bond_salt_amount;
    signal input collateral_notional;
    signal input bond_salt_value;
    signal input borrow_price;
    signal input bond_salt_price;

    // 1. Reconstruct the loan commitment.
    component loanCommit = Poseidon(4);
    loanCommit.inputs[0] <== loan_amount;
    loanCommit.inputs[1] <== loan_asset_tag;
    loanCommit.inputs[2] <== sk;
    loanCommit.inputs[3] <== loan_salt;
    loanCommit.out === loan_commitment;

    // 2. Reconstruct the 3 bond commitments.
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

    // 3. Underwater check:
    //     loan_amount * threshold_bps * borrow_price
    //       > collateral_notional * current_price * 10_000
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

    // 4. Nullifier binds the loan to (sk, loan_index).
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== sk;
    nullifier.inputs[1] <== loan_index;
    nullifier.out === loan_nullifier;
}

component main {public [
    loan_commitment,
    borrow_amount_commit,
    collateral_value_commit,
    borrow_price_commit,
    current_price,
    threshold_bps,
    loan_nullifier
]} = Liquidate();
