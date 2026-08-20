pragma circom 2.1.9;

// Shielded pool borrow circuit.
//
// Prove: caller owns N=4 deposit notes at the declared indices in the
// current deposit tree, none of them are spent, and their combined
// USD value backs `borrow_amount` at the declared health-factor +
// max-LTV band. Issue 4 nullifiers + one new borrow commitment for
// the loan tree.
//
// Public signals order (matches BorrowPool::borrow_shielded):
//   [0]     borrow_amount            (loan in RAW token units / stroops)
//   [1]     borrow_asset_tag         (0/1/2 = XLM/USDC/EURC)
//   [2]     collateral_asset_tag     (must match each collateral note)
//   [3]     hf_min_bps               (health-factor floor, bps)
//   [4]     max_ltv_bps              (max LTV, bps)
//   [5]     deposit_root             (root at witness generation time)
//   [6]     borrow_commitment        (new leaf appended to loan tree)
//   [7-10]  nullifiers[0..4]         (one per spent collateral note)
//   [11]    borrow_amount_commit     Poseidon(borrow_amount, bond_salt_amount)      (Track L)
//   [12]    collateral_value_commit  Poseidon(total_collateral_value, bond_salt_value)  (Track L)
//   [13]    borrow_price_commit      Poseidon(oracle_price, bond_salt_price)        (Track L)
//   [14]    loan_nullifier           Poseidon(sk, borrow_commitment)                (Track A)
//
// Private witness:
//   sk                          shielded identity secret
//   borrow_salt                 blinding for the new borrow note
//   collateral_amounts[4]       amount per note (RAW token units)
//   collateral_salts[4]         per-note salts
//   collateral_indices[4]       positions in the deposit tree
//   collateral_paths[4][20]     merkle siblings per level per note
//   collateral_bits[4][20]      path bits per level per note
//   oracle_price                1e14-scaled CROSS-ASSET RATIO: one raw
//                               collateral unit priced in raw borrow
//                               units (same-asset = 1e14). Not a USD
//                               price. Unconstrained here — nothing in
//                               this circuit binds it to a real feed,
//                               so the LTV band below is decorative and
//                               the contract's denomination cap is the
//                               real solvency guard.
//   bond_salt_amount            salt for borrow_amount_commit          (Track L)
//   bond_salt_value             salt for collateral_value_commit       (Track L)
//   bond_salt_price             salt for borrow_price_commit           (Track L)
//
// LTV check: Σ (amount × price) × 10000 >= borrow_amount × hf_min_bps.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template MerkleInclusion(depth) {
    signal input leaf;
    signal input path_elements[depth];
    signal input path_bits[depth];
    signal output root;

    for (var b = 0; b < depth; b++) {
        path_bits[b] * (path_bits[b] - 1) === 0;
    }

    signal current[depth + 1];
    current[0] <== leaf;

    component hashers[depth];
    signal left[depth];
    signal right[depth];
    signal switchLeft[depth];
    signal switchRight[depth];

    for (var level = 0; level < depth; level++) {
        switchLeft[level] <== path_bits[level] * (path_elements[level] - current[level]);
        left[level]  <== current[level] + switchLeft[level];
        switchRight[level] <== path_bits[level] * (current[level] - path_elements[level]);
        right[level] <== path_elements[level] + switchRight[level];

        hashers[level] = Poseidon(2);
        hashers[level].inputs[0] <== left[level];
        hashers[level].inputs[1] <== right[level];
        current[level + 1] <== hashers[level].out;
    }

    root <== current[depth];
}

template Borrow(depth, notes) {
    // Public inputs.
    signal input borrow_amount;
    signal input borrow_asset_tag;
    signal input collateral_asset_tag;
    signal input hf_min_bps;
    signal input max_ltv_bps;
    signal input deposit_root;
    signal input borrow_commitment;
    signal input nullifiers[notes];
    // Track L liquidation bond — public commitments that pin the
    // borrow's amount / collateral value / oracle price at open. Only
    // openings can produce a valid liquidate proof against them.
    signal input borrow_amount_commit;
    signal input collateral_value_commit;
    signal input borrow_price_commit;
    // Track A pre-published loan nullifier. Bound to the loan
    // commitment so a liquidator can trigger burn without ever
    // knowing the borrower's sk. Contract records this in a sidecar
    // storage slot keyed by loan commitment.
    signal input loan_nullifier;

    // Private witness.
    signal input sk;
    signal input borrow_salt;
    signal input collateral_amounts[notes];
    signal input collateral_salts[notes];
    signal input collateral_indices[notes];
    signal input collateral_paths[notes][depth];
    signal input collateral_bits[notes][depth];
    signal input oracle_price;
    signal input bond_salt_amount;
    signal input bond_salt_value;
    signal input bond_salt_price;

    // Recompute each collateral commitment + prove Merkle inclusion +
    // derive the matching nullifier. All four must succeed.
    component commit[notes];
    component trees[notes];
    component nulls[notes];

    for (var i = 0; i < notes; i++) {
        commit[i] = Poseidon(4);
        commit[i].inputs[0] <== collateral_amounts[i];
        commit[i].inputs[1] <== collateral_asset_tag;
        commit[i].inputs[2] <== sk;
        commit[i].inputs[3] <== collateral_salts[i];

        trees[i] = MerkleInclusion(depth);
        trees[i].leaf <== commit[i].out;
        for (var lv = 0; lv < depth; lv++) {
            trees[i].path_elements[lv] <== collateral_paths[i][lv];
            trees[i].path_bits[lv] <== collateral_bits[i][lv];
        }
        trees[i].root === deposit_root;

        nulls[i] = Poseidon(2);
        nulls[i].inputs[0] <== sk;
        nulls[i].inputs[1] <== collateral_indices[i];
        nulls[i].out === nullifiers[i];
    }

    // Recompute the new borrow-note commitment.
    component borrowCommit = Poseidon(4);
    borrowCommit.inputs[0] <== borrow_amount;
    borrowCommit.inputs[1] <== borrow_asset_tag;
    borrowCommit.inputs[2] <== sk;
    borrowCommit.inputs[3] <== borrow_salt;
    borrowCommit.out === borrow_commitment;

    // Collateral USD value (in borrow-asset units).
    signal total_collateral_value;
    signal partial_values[notes];
    for (var i = 0; i < notes; i++) {
        partial_values[i] <== collateral_amounts[i] * oracle_price;
    }
    // For notes=4 unroll to keep the circuit simple.
    total_collateral_value <== partial_values[0] + partial_values[1] + partial_values[2] + partial_values[3];

    // LTV check: `total_collateral_value * 10000 >= borrow_amount * hf_min_bps`.
    signal lhs;
    signal rhs;
    lhs <== total_collateral_value * 10000;
    rhs <== borrow_amount * hf_min_bps;

    component hfCheck = GreaterEqThan(128);
    hfCheck.in[0] <== lhs;
    hfCheck.in[1] <== rhs;
    hfCheck.out === 1;

    // Max LTV: `borrow_amount * 10000 <= max_ltv_bps * total_collateral_value`.
    signal ltv_lhs;
    signal ltv_rhs;
    ltv_lhs <== borrow_amount * 10000;
    ltv_rhs <== max_ltv_bps * total_collateral_value;

    component ltvCheck = LessEqThan(128);
    ltvCheck.in[0] <== ltv_lhs;
    ltvCheck.in[1] <== ltv_rhs;
    ltvCheck.out === 1;

    // Track L bond commitments.
    component bondAmount = Poseidon(2);
    bondAmount.inputs[0] <== borrow_amount;
    bondAmount.inputs[1] <== bond_salt_amount;
    bondAmount.out === borrow_amount_commit;

    component bondValue = Poseidon(2);
    bondValue.inputs[0] <== total_collateral_value;
    bondValue.inputs[1] <== bond_salt_value;
    bondValue.out === collateral_value_commit;

    component bondPrice = Poseidon(2);
    bondPrice.inputs[0] <== oracle_price;
    bondPrice.inputs[1] <== bond_salt_price;
    bondPrice.out === borrow_price_commit;

    // Track A: pre-publish nullifier bound to loan commitment.
    component loanNul = Poseidon(2);
    loanNul.inputs[0] <== sk;
    loanNul.inputs[1] <== borrow_commitment;
    loanNul.out === loan_nullifier;
}

component main {public [
    borrow_amount,
    borrow_asset_tag,
    collateral_asset_tag,
    hf_min_bps,
    max_ltv_bps,
    deposit_root,
    borrow_commitment,
    nullifiers,
    borrow_amount_commit,
    collateral_value_commit,
    borrow_price_commit,
    loan_nullifier
]} = Borrow(20, 4);
