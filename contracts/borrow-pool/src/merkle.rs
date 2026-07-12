//! Zcash-pattern incremental Merkle tree over Poseidon.
//!
//! Only the current root + a `DEPTH`-sized frontier + a leaf counter
//! live in contract storage. Full-tree hashes are never stored on
//! chain — the user maintains their inclusion witness client-side,
//! and the circuit proves membership at the current root without any
//! extra help from the contract.
//!
//! Every leaf append recomputes exactly `DEPTH` interior hashes: the
//! frontier caches the right-most partial path, so once we know which
//! leaf we're inserting we walk from the bottom up, combining with
//! either a sibling from the frontier (left branch) or the pre-computed
//! zero-subtree hash for that level (right branch).
//!
//! Trees are keyed elsewhere (per asset / per operation); this module
//! only owns the algorithm.

#![allow(dead_code)]

use soroban_sdk::{crypto::bls12_381::Fr, BytesN, Env};

use crate::merkle_zeros::ZERO_HASHES;
use crate::poseidon;

/// Tree depth. `2^DEPTH = 1_048_576` leaves — plenty for MVP.
pub const DEPTH: usize = 20;

/// Zero-subtree hash for each level. `zero_hashes[0]` = `Fr::zero()`;
/// `zero_hashes[i]` = `Poseidon(zero_hashes[i-1], zero_hashes[i-1])`.
///
/// Sourced from `ZERO_HASHES` constants — recomputing them from
/// scratch on every append via Poseidon(Fr, Fr) blows the network
/// per-tx instruction budget once the tree gets past ~5 levels. The
/// constants are generated from `features/notes/merkle.ts::zeroHashes()`
/// so JS + Rust stay byte-identical.
fn zero_hashes(env: &Env) -> [Fr; DEPTH + 1] {
    core::array::from_fn(|i| Fr::from_bytes(BytesN::from_array(env, &ZERO_HASHES[i])))
}

/// Root of the tree before any leaves have been appended.
pub fn empty_root(env: &Env) -> Fr {
    zero_hashes(env)[DEPTH].clone()
}

/// Append `leaf` at position `next_index`, update `frontier` in place,
/// return the new root. Caller persists the new frontier + increments
/// `next_index`.
///
/// Panics if `next_index` overflows the tree capacity — the contract
/// checks this before calling.
pub fn append(
    env: &Env,
    leaf: &Fr,
    frontier: &mut [Fr; DEPTH],
    next_index: u64,
) -> Fr {
    let zeros = zero_hashes(env);
    let mut current = leaf.clone();
    let mut index = next_index;

    for level in 0..DEPTH {
        let is_left = index & 1 == 0;
        if is_left {
            // We're the left child of this parent. Cache our value in
            // the frontier so a future right-sibling can combine with
            // it, and pair with the zero-subtree hash to derive the
            // interior node.
            frontier[level] = current.clone();
            current = poseidon::hash_two_to_one(env, &current, &zeros[level]);
        } else {
            // We're the right child. Combine with the frontier entry
            // for our left sibling.
            current = poseidon::hash_two_to_one(env, &frontier[level], &current);
        }
        index >>= 1;
    }

    current
}

/// Append four leaves starting at `next_index` which MUST be a
/// multiple of 4. Computes the local subtree root of the four leaves
/// once (3 Poseidon(2) hashes) and then walks that subtree root up
/// through the remaining `DEPTH - 2` levels of the tree — versus 4×
/// full walks (80 Poseidon(2) hashes) for four back-to-back `append`
/// calls. Every append still emits the correct frontier + leaf-level
/// state so future singleton `append` calls remain consistent.
pub fn append_four_aligned(
    env: &Env,
    leaves: &[Fr; 4],
    frontier: &mut [Fr; DEPTH],
    next_index: u64,
) -> Fr {
    debug_assert_eq!(next_index & 0b11, 0, "next_index must be 4-aligned");
    let zeros = zero_hashes(env);

    // Level 0 & 1: fill from the four fresh leaves.
    let l1a = poseidon::hash_two_to_one(env, &leaves[0], &leaves[1]);
    let l1b = poseidon::hash_two_to_one(env, &leaves[2], &leaves[3]);
    let mut current = poseidon::hash_two_to_one(env, &l1a, &l1b);

    // Frontier at levels 0 and 1 mirrors what a per-leaf append would
    // have written at position `next_index + 3`:
    //   - level 0: leaves[3] (right child of leaves[2])
    //   - level 1: l1b        (right child of l1a)
    frontier[0] = leaves[3].clone();
    frontier[1] = l1b;

    // Walk `current` (subtree root at level 2) up through the rest of
    // the tree. Index at level 2 is `next_index / 4`.
    let mut index = next_index >> 2;
    for level in 2..DEPTH {
        let is_left = index & 1 == 0;
        if is_left {
            frontier[level] = current.clone();
            current = poseidon::hash_two_to_one(env, &current, &zeros[level]);
        } else {
            current = poseidon::hash_two_to_one(env, &frontier[level], &current);
        }
        index >>= 1;
    }
    current
}

/// Verify that `leaf` at `leaf_index` hashes up through `path` to
/// `root`. The circuit already enforces this, so this is a spot-check
/// utility for tests / dev tools — the contract itself doesn't
/// verify inclusion in production paths (proofs handle that).
pub fn verify_inclusion(
    env: &Env,
    leaf: &Fr,
    leaf_index: u64,
    path: &[Fr; DEPTH],
    root: &Fr,
) -> bool {
    let mut current = leaf.clone();
    let mut index = leaf_index;
    for level in 0..DEPTH {
        let sibling = &path[level];
        current = if index & 1 == 0 {
            poseidon::hash_two_to_one(env, &current, sibling)
        } else {
            poseidon::hash_two_to_one(env, sibling, &current)
        };
        index >>= 1;
    }
    &current == root
}
