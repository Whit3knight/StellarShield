pragma circom 2.1.9;

// Shielded pool repay circuit.
//
// Burns one loan note + one deposit note of the same asset. Contract
// checks both nullifiers unused, marks them used, decrements
// total_borrow. No public wallet transfer — both sides stay shielded.
//
// Collateral notes stay burned from the original borrow. Repayer
// deliberately gives up a same-asset deposit note worth >= the loan
// amount; the difference is retained by the pool as effective fee /
// realized interest. Full collateral recovery + accrued-interest
// borrow_index snapshot is deferred to a v2 repay circuit.
//
// Public signals:
//   [0] asset_tag
//   [1] loan_root
//   [2] deposit_root
//   [3] loan_nullifier
//   [4] deposit_nullifier
//   [5] borrow_index_snapshot   (Track D — index_at_open, 1e18 fixed)
//   [6] borrow_index_now        (Track D — index accrued to tx time, 1e18 fixed)
//
// Track D solvency invariant (integer-safe rearrangement):
//   deposit_amount * borrow_index_snapshot
//     >= loan_amount * borrow_index_now
//
// Private witness:
//   sk
//   loan_amount, loan_salt, loan_index, loan_path_elements[20], loan_path_bits[20]
//   deposit_amount, deposit_salt, deposit_index, deposit_path_elements[20], deposit_path_bits[20]

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

template Repay(depth) {
    // Public.
    signal input asset_tag;
    signal input loan_root;
    signal input deposit_root;
    signal input loan_nullifier;
    signal input deposit_nullifier;
    signal input borrow_index_snapshot;
    signal input borrow_index_now;

    // Private.
    signal input sk;

    signal input loan_amount;
    signal input loan_salt;
    signal input loan_index;
    signal input loan_path_elements[depth];
    signal input loan_path_bits[depth];

    signal input deposit_amount;
    signal input deposit_salt;
    signal input deposit_index;
    signal input deposit_path_elements[depth];
    signal input deposit_path_bits[depth];

    // Loan-side commitment + inclusion + nullifier.
    component loanCommit = Poseidon(4);
    loanCommit.inputs[0] <== loan_amount;
    loanCommit.inputs[1] <== asset_tag;
    loanCommit.inputs[2] <== sk;
    loanCommit.inputs[3] <== loan_salt;

    component loanTree = MerkleInclusion(depth);
    loanTree.leaf <== loanCommit.out;
    for (var i = 0; i < depth; i++) {
        loanTree.path_elements[i] <== loan_path_elements[i];
        loanTree.path_bits[i] <== loan_path_bits[i];
    }
    loanTree.root === loan_root;

    component loanNul = Poseidon(2);
    loanNul.inputs[0] <== sk;
    loanNul.inputs[1] <== loan_index;
    loanNul.out === loan_nullifier;

    // Deposit-side commitment + inclusion + nullifier.
    component depCommit = Poseidon(4);
    depCommit.inputs[0] <== deposit_amount;
    depCommit.inputs[1] <== asset_tag;
    depCommit.inputs[2] <== sk;
    depCommit.inputs[3] <== deposit_salt;

    component depTree = MerkleInclusion(depth);
    depTree.leaf <== depCommit.out;
    for (var i = 0; i < depth; i++) {
        depTree.path_elements[i] <== deposit_path_elements[i];
        depTree.path_bits[i] <== deposit_path_bits[i];
    }
    depTree.root === deposit_root;

    component depNul = Poseidon(2);
    depNul.inputs[0] <== sk;
    depNul.inputs[1] <== deposit_index;
    depNul.out === deposit_nullifier;

    // Track D: deposit_amount * snapshot >= loan_amount * index_now
    // (rearranged from `deposit_amount >= loan_amount * index_now /
    // snapshot` so both sides stay integers). Amounts are whole
    // units, indices are 1e18 fixed-point → each side fits inside
    // ~87 bits worst case (100 * 1e18 * modest growth). 200-bit
    // comparator leaves ample headroom.
    signal lhs;
    signal rhs;
    lhs <== deposit_amount * borrow_index_snapshot;
    rhs <== loan_amount * borrow_index_now;

    component ge = GreaterEqThan(200);
    ge.in[0] <== lhs;
    ge.in[1] <== rhs;
    ge.out === 1;
}

component main {public [
    asset_tag,
    loan_root,
    deposit_root,
    loan_nullifier,
    deposit_nullifier,
    borrow_index_snapshot,
    borrow_index_now
]} = Repay(20);
