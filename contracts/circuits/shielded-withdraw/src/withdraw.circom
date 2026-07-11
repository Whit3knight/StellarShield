pragma circom 2.1.9;

// Shielded pool withdraw circuit.
//
// Prove: caller owns a deposit note at leaf `index` inside the current
// deposit tree; issue `nullifier = Poseidon(sk, index)` so the note
// can't be spent twice. Contract enforces:
//   * `nullifier` is unused
//   * declared `asset_tag` matches the target reserve
//   * `denomination` matches `notes::denomination(asset)`
// and then releases exactly `denomination` tokens to the caller.
//
// Public signals (order matches BorrowPool::withdraw_shielded):
//   [0] asset_tag
//   [1] denomination
//   [2] deposit_root
//   [3] nullifier
//
// Private witness:
//   sk           user secret (shielded identity)
//   salt         note salt
//   leaf_index   position in the tree (0..2^depth-1)
//   path_elements[depth]   sibling hash at each level
//   path_bits[depth]       0 = we're the left child, 1 = right

include "circomlib/circuits/poseidon.circom";

// Merkle inclusion over Poseidon(2). Given a leaf + siblings + path
// bits, reconstruct the root the tree would have if the leaf lived at
// `leaf_index`. Matches `IncrementalMerkleTree` on the Rust + JS
// sides (features/notes/merkle.ts, contracts/borrow-pool/src/merkle.rs).
template MerkleInclusion(depth) {
    signal input leaf;
    signal input path_elements[depth];
    signal input path_bits[depth];
    signal output root;

    // Enforce every path bit is boolean.
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
        // When bit = 0 we're the left child → pair (current, sibling).
        // When bit = 1 we're the right child → pair (sibling, current).
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

template Withdraw(depth) {
    // Public inputs.
    signal input asset_tag;
    signal input denomination;
    signal input deposit_root;
    signal input nullifier;

    // Private witness.
    signal input sk;
    signal input salt;
    signal input leaf_index;
    signal input path_elements[depth];
    signal input path_bits[depth];

    // 1. Reconstruct the commitment.
    component commit = Poseidon(4);
    commit.inputs[0] <== denomination;
    commit.inputs[1] <== asset_tag;
    commit.inputs[2] <== sk;
    commit.inputs[3] <== salt;

    // 2. Merkle inclusion at `leaf_index`.
    component tree = MerkleInclusion(depth);
    tree.leaf <== commit.out;
    for (var level = 0; level < depth; level++) {
        tree.path_elements[level] <== path_elements[level];
        tree.path_bits[level] <== path_bits[level];
    }
    tree.root === deposit_root;

    // 3. Nullifier binds the note to `sk` + `leaf_index`.
    component nul = Poseidon(2);
    nul.inputs[0] <== sk;
    nul.inputs[1] <== leaf_index;
    nul.out === nullifier;
}

component main {public [asset_tag, denomination, deposit_root, nullifier]} = Withdraw(20);
