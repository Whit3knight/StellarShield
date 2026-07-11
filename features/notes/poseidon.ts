// Poseidon over BLS12-381 Fr — pure bigint impl.
//
// Why not `circomlibjs`? circomlibjs's Poseidon operates on BN254
// arithmetic. Our circom circuits compile with `-p bls12381` (Soroban
// only exposes BLS12-381 host functions, not BN254), so client-side
// commitments have to be produced with the *same* field or every
// zk proof will fail with "public output mismatch".
//
// Constants come from circomlib's `poseidon_constants.json` (BN254
// generation parameters). Those hex constants happen to be < 254 bits
// so their canonical representation in BLS12-381 Fr matches the raw
// value — same permutation, different modulus. The Rust port in
// `contracts/borrow-pool/src/poseidon.rs` reads the same JSON at
// build time so both sides stay in lockstep.
//
// Round schedule:
//   R_F = 8 (full rounds, split 4 + 4)
//   R_P per t (56, 57, 60, 63 for t = 2, 3, 5, 7)
//   S-box: x^5

import poseidonConstants from "./poseidon-constants.json"

/** BLS12-381 scalar field prime r. */
export const FR_ORDER =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n

// Round-count schedule matches circomlib. Indexed by t.
const R_P: Record<number, number> = { 3: 57, 5: 60, 7: 63 }
const R_F = 8

type ParsedConstants = {
  C: Record<number, bigint[]>
  M: Record<number, bigint[][]>
}

let parsed: ParsedConstants | null = null

function parseConstants(): ParsedConstants {
  if (parsed) return parsed
  const raw = poseidonConstants as {
    C: Record<string, string[]>
    M: Record<string, string[][]>
  }
  const C: Record<number, bigint[]> = {}
  const M: Record<number, bigint[][]> = {}
  for (const t of Object.keys(raw.C)) {
    const key = Number(t)
    C[key] = raw.C[t].map((hex) => BigInt(hex) % FR_ORDER)
    M[key] = raw.M[t].map((row) => row.map((cell) => BigInt(cell) % FR_ORDER))
  }
  parsed = { C, M }
  return parsed
}

function addMod(a: bigint, b: bigint): bigint {
  const value = (a + b) % FR_ORDER
  return value < 0n ? value + FR_ORDER : value
}

function mulMod(a: bigint, b: bigint): bigint {
  return (a * b) % FR_ORDER
}

function pow5(value: bigint): bigint {
  const squared = mulMod(value, value)
  const fourth = mulMod(squared, squared)
  return mulMod(fourth, value)
}

/**
 * Poseidon(inputs). t = inputs.length + 1. Supported input widths:
 * 2 (t=3), 4 (t=5), 6 (t=7) — matches every arity our circuits need.
 */
export function poseidon(inputs: bigint[]): bigint {
  const t = inputs.length + 1
  if (!(t in R_P)) {
    throw new Error(
      `Poseidon: unsupported width t=${t} (input length ${inputs.length})`
    )
  }
  const { C, M } = parseConstants()
  const constants = C[t]
  const matrix = M[t]
  const partial = R_P[t]

  let state: bigint[] = [0n, ...inputs.map((input) => input % FR_ORDER)]
  const totalRounds = R_F + partial

  for (let round = 0; round < totalRounds; round++) {
    // Add round constants.
    for (let i = 0; i < t; i++) {
      state[i] = addMod(state[i], constants[round * t + i])
    }

    // S-box. Full rounds hit every state element; partial rounds
    // apply only to state[0].
    const isFull = round < R_F / 2 || round >= R_F / 2 + partial
    if (isFull) {
      for (let i = 0; i < t; i++) state[i] = pow5(state[i])
    } else {
      state[0] = pow5(state[0])
    }

    // MDS matrix multiplication.
    const next = new Array<bigint>(t).fill(0n)
    for (let i = 0; i < t; i++) {
      let acc = 0n
      for (let j = 0; j < t; j++) {
        acc = addMod(acc, mulMod(matrix[i][j], state[j]))
      }
      next[i] = acc
    }
    state = next
  }

  return state[0]
}
