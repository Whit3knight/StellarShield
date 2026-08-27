pragma circom 2.1.9;

// Shielded pool repay circuit — v2 (collateral recovery).
//
// Does everything v1 (contracts/circuits/shielded-repay/) does — burns
// one loan note + one same-asset deposit-source note, enforces the
// Track D solvency inequality — plus mints a new deposit-tree
// commitment recovering the ORIGINAL collateral, instead of leaving it
// forfeited forever. See docs/REMEDIATION.md R23.
//
// The recovered amount is reconstructed from the loan's own Track L
// bond (contracts/borrow-pool/src/state.rs's `LiquidationBond`,
// written unconditionally at borrow time): `collateral_value_commit`
// opens to `total_collateral_value = raw_collateral_amount *
// collateral_oracle_price` (an honest product fixed at borrow time —
// see borrow.circom). This circuit takes `raw_collateral_amount` as a
// private witness and PROVES it via that multiplication, not by
// dividing `total_collateral_value` back out (circom's `/` is
// field-inverse multiplication, not integer division, and only gives
// the intended quotient when the division is exact — see the R22
// writeup in docs/REMEDIATION.md for the bug that taught this
// project that lesson the hard way). No borrow.circom change needed —
// nothing new has to be committed at borrow time.
//
// `loan_commitment` is exposed as a public signal here (v1 never
// does) so the contract can verify its `loan_commitment` tx argument
// actually matches the note this proof repays BEFORE trusting the
// `LiquidationBond` lookup keyed by it — without this, a caller could
// point the tx arg at someone else's fatter bond and mint a larger
// recovered note than they're entitled to.
//
// Public signals:
//   [0]  asset_tag                loan/borrow asset
//   [1]  loan_root
//   [2]  deposit_root             loan asset's deposit tree (repay-source note)
//   [3]  loan_nullifier
//   [4]  deposit_nullifier
//   [5]  borrow_index_snapshot    (Track D — index_at_open, 1e18 fixed)
//   [6]  borrow_index_now         (Track D — index accrued to tx time, 1e18 fixed)
//   [7]  loan_commitment          binds the tx arg to this specific note
//   [8]  collateral_asset_tag     collateral can differ from the loan asset
//   [9]  collateral_value_commit  from LiquidationBond — cross-checked by the contract
//   [10] borrow_price_commit      from LiquidationBond — cross-checked by the contract
//   [11] recovered_commitment     new deposit-tree leaf for the collateral asset
//
// Track D solvency invariant (integer-safe rearrangement, same as v1):
//   deposit_amount * borrow_index_snapshot
//     >= loan_amount * borrow_index_now
//
// Private witness:
//   sk
//   loan_amount, loan_salt, loan_index, loan_path_elements[20], loan_path_bits[20]
//   deposit_amount, deposit_salt, deposit_index, deposit_path_elements[20], deposit_path_bits[20]
//   raw_collateral_amount, bond_salt_value               collateral_value_commit opening
//   collateral_oracle_price, bond_salt_price              borrow_price_commit opening
//   new_collateral_salt                                   blinding for recovered_commitment

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

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

template RepayV2(depth) {
    // Public.
    signal input asset_tag;
    signal input loan_root;
    signal input deposit_root;
    signal input loan_nullifier;
    signal input deposit_nullifier;
    signal input borrow_index_snapshot;
    signal input borrow_index_now;
    signal input loan_commitment;
    signal input collateral_asset_tag;
    signal input collateral_value_commit;
    signal input borrow_price_commit;
    signal input recovered_commitment;

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

    signal input raw_collateral_amount;
    signal input bond_salt_value;
    signal input collateral_oracle_price;
    signal input bond_salt_price;
    signal input new_collateral_salt;

    // Loan-side commitment + inclusion + nullifier.
    component loanCommit = Poseidon(4);
    loanCommit.inputs[0] <== loan_amount;
    loanCommit.inputs[1] <== asset_tag;
    loanCommit.inputs[2] <== sk;
    loanCommit.inputs[3] <== loan_salt;
    loanCommit.out === loan_commitment;

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

    // Deposit-side commitment + inclusion + nullifier (repay-source note).
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

    // Range-check both index signals to 128 bits — see v1's identical
    // comment for why (contract's fr_to_u128 read must match what the
    // circuit used, or a >2^128 witness could defeat the inequality).
    component snapshotBits = Num2Bits(128);
    snapshotBits.in <== borrow_index_snapshot;
    component nowBits = Num2Bits(128);
    nowBits.in <== borrow_index_now;

    // Track D: deposit_amount * snapshot >= loan_amount * index_now.
    signal lhs;
    signal rhs;
    lhs <== deposit_amount * borrow_index_snapshot;
    rhs <== loan_amount * borrow_index_now;

    component ge = GreaterEqThan(200);
    ge.in[0] <== lhs;
    ge.in[1] <== rhs;
    ge.out === 1;

    // Collateral recovery: reconstruct + assert the Track L bond
    // fields, then prove raw_collateral_amount is consistent with the
    // committed total_collateral_value via multiplication (no
    // division — see this file's header comment).
    component bondPrice = Poseidon(2);
    bondPrice.inputs[0] <== collateral_oracle_price;
    bondPrice.inputs[1] <== bond_salt_price;
    bondPrice.out === borrow_price_commit;

    signal total_collateral_value;
    total_collateral_value <== raw_collateral_amount * collateral_oracle_price;

    component bondValue = Poseidon(2);
    bondValue.inputs[0] <== total_collateral_value;
    bondValue.inputs[1] <== bond_salt_value;
    bondValue.out === collateral_value_commit;

    component recoveredCommit = Poseidon(4);
    recoveredCommit.inputs[0] <== raw_collateral_amount;
    recoveredCommit.inputs[1] <== collateral_asset_tag;
    recoveredCommit.inputs[2] <== sk;
    recoveredCommit.inputs[3] <== new_collateral_salt;
    recoveredCommit.out === recovered_commitment;
}

component main {public [
    asset_tag,
    loan_root,
    deposit_root,
    loan_nullifier,
    deposit_nullifier,
    borrow_index_snapshot,
    borrow_index_now,
    loan_commitment,
    collateral_asset_tag,
    collateral_value_commit,
    borrow_price_commit,
    recovered_commitment
]} = RepayV2(20);
