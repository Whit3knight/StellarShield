// Client-side incremental Merkle tree over Poseidon. Mirrors the Rust
// impl at `contracts/borrow-pool/src/merkle.rs` bit-for-bit so a user
// can maintain their own copy of the tree, generate inclusion
// witnesses without contract help, and cross-check any interior hash
// they need for a proof.

import { poseidon } from "./poseidon"

/** Matches `merkle::DEPTH` in the Rust module. */
export const DEPTH = 20

/** Root of an empty depth-`DEPTH` tree. */
export function emptyRoot(): bigint {
  return zeroHashes()[DEPTH]
}

/**
 * Precomputed zero-subtree hash per level. `zero[0] = 0`;
 * `zero[i] = Poseidon(zero[i-1], zero[i-1])`.
 */
export function zeroHashes(): bigint[] {
  const hashes = new Array<bigint>(DEPTH + 1).fill(0n)
  for (let level = 1; level <= DEPTH; level++) {
    hashes[level] = poseidon([hashes[level - 1], hashes[level - 1]])
  }
  return hashes
}

export type MerklePath = bigint[]

export type AppendResult = {
  path: MerklePath
  root: bigint
}

/**
 * Append `leaf` at position `nextIndex`, mutate `frontier` in place,
 * return `{ root, path }`. The `path` is what the user records to
 * later prove inclusion of this leaf — one sibling per level.
 */
export function append({
  frontier,
  leaf,
  nextIndex,
}: {
  frontier: bigint[]
  leaf: bigint
  nextIndex: number
}): AppendResult {
  const zeros = zeroHashes()
  const path: bigint[] = new Array(DEPTH).fill(0n)
  let current = leaf
  let index = nextIndex

  for (let level = 0; level < DEPTH; level++) {
    const isLeft = (index & 1) === 0
    if (isLeft) {
      path[level] = zeros[level]
      frontier[level] = current
      current = poseidon([current, zeros[level]])
    } else {
      path[level] = frontier[level]
      current = poseidon([frontier[level], current])
    }
    index >>= 1
  }

  return { path, root: current }
}

/**
 * Reproduce the root by hashing `leaf` up through `path`. If it
 * matches `root`, membership holds.
 */
export function verifyInclusion({
  leaf,
  leafIndex,
  path,
  root,
}: {
  leaf: bigint
  leafIndex: number
  path: MerklePath
  root: bigint
}): boolean {
  let current = leaf
  let index = leafIndex
  for (let level = 0; level < DEPTH; level++) {
    const sibling = path[level]
    current =
      (index & 1) === 0
        ? poseidon([current, sibling])
        : poseidon([sibling, current])
    index >>= 1
  }
  return current === root
}
