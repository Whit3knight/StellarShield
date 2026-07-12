// Poseidon over BLS12-381 Fr — mirror of `contracts/circuits/**/*.circom`'s
// use of `circomlib/circuits/poseidon.circom::Poseidon(nInputs)`.
//
// The circomlib circuit uses the "optimized" Poseidon variant with a
// sparse-matrix partial round layout: full rounds add `t` constants and
// mix via `M`, partial rounds add one constant + apply x^5 to state[0]
// only, then mix via a sparse `S`-derived matrix. Constants come from
// circomlib's `poseidon_constants.circom` — extracted verbatim into
// `poseidon-constants.json` for JS + Rust to share.
//
// Under `-p bls12381` the field is BLS12-381 Fr (not BN254 as circomlib
// defaults to). All arithmetic here mirrors that. Any drift between
// this file, `poseidon-constants.json`, the Rust port in
// `contracts/borrow-pool/src/poseidon.rs`, and the circom circuit
// breaks every proof.

import poseidonConstants from "./poseidon-constants.json"

/** BLS12-381 scalar field prime r. */
export const FR_ORDER =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n

const R_F = 8
// Partial round counts (indexed by t).
const R_P: Record<number, number> = { 3: 57, 5: 60, 7: 63 }

type ParsedConstants = {
  C: Record<number, bigint[]>
  M: Record<number, bigint[][]>
  P: Record<number, bigint[][]>
  S: Record<number, bigint[]>
}

let parsed: ParsedConstants | null = null

function parseConstants(): ParsedConstants {
  if (parsed) return parsed
  const raw = poseidonConstants as {
    C: Record<string, string[]>
    M: Record<string, string[][]>
    P: Record<string, string[][]>
    S: Record<string, string[]>
  }
  const C: Record<number, bigint[]> = {}
  const M: Record<number, bigint[][]> = {}
  const P: Record<number, bigint[][]> = {}
  const S: Record<number, bigint[]> = {}
  for (const t of Object.keys(raw.C)) {
    const key = Number(t)
    C[key] = raw.C[t].map(hexToField)
    M[key] = raw.M[t].map((row) => row.map(hexToField))
    P[key] = raw.P[t].map((row) => row.map(hexToField))
    S[key] = raw.S[t].map(hexToField)
  }
  parsed = { C, M, P, S }
  return parsed
}

function hexToField(hex: string): bigint {
  return reduce(BigInt(hex))
}

function reduce(value: bigint): bigint {
  const v = value % FR_ORDER
  return v < 0n ? v + FR_ORDER : v
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
 * Multiply state vector by matrix `mat`: `out[i] = sum_j mat[j][i] * in[j]`.
 * Matches circomlib's `Mix` template (out uses column j of row-major mat).
 */
function mixVec(mat: bigint[][], state: bigint[], t: number): bigint[] {
  const next = new Array<bigint>(t).fill(0n)
  for (let i = 0; i < t; i++) {
    let acc = 0n
    for (let j = 0; j < t; j++) {
      acc = addMod(acc, mulMod(mat[j][i], state[j]))
    }
    next[i] = acc
  }
  return next
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
  const { C, M, P, S } = parseConstants()
  const c = C[t]
  const m = M[t]
  const p = P[t]
  const s = S[t]
  const nRoundsP = R_P[t]

  // Initial state: [0, ...inputs]. Inputs are reduced mod FR_ORDER.
  let state: bigint[] = [0n, ...inputs.map(reduce)]

  // ark[0]
  for (let j = 0; j < t; j++) state[j] = addMod(state[j], c[j])

  // First half full rounds: 3 iterations (R_F/2 - 1 = 3).
  for (let r = 0; r < R_F / 2 - 1; r++) {
    // sigmaF (all elems)
    for (let j = 0; j < t; j++) state[j] = pow5(state[j])
    // ark[r+1]
    const off = (r + 1) * t
    for (let j = 0; j < t; j++) state[j] = addMod(state[j], c[off + j])
    // mix with M
    state = mixVec(m, state, t)
  }

  // Transition: full sigma + ark + mix with P.
  for (let j = 0; j < t; j++) state[j] = pow5(state[j])
  {
    const off = (R_F / 2) * t
    for (let j = 0; j < t; j++) state[j] = addMod(state[j], c[off + j])
  }
  state = mixVec(p, state, t)

  // Partial rounds.
  const stride = t * 2 - 1
  for (let r = 0; r < nRoundsP; r++) {
    state[0] = pow5(state[0])
    state[0] = addMod(state[0], c[(R_F / 2 + 1) * t + r])
    const s0 = state[0]
    const newState = new Array<bigint>(t).fill(0n)
    let acc = 0n
    for (let j = 0; j < t; j++) {
      acc = addMod(acc, mulMod(s[r * stride + j], state[j]))
    }
    newState[0] = acc
    for (let i = 1; i < t; i++) {
      newState[i] = addMod(state[i], mulMod(s0, s[r * stride + t + i - 1]))
    }
    state = newState
  }

  // Second half full rounds: 3 iterations.
  for (let r = 0; r < R_F / 2 - 1; r++) {
    for (let j = 0; j < t; j++) state[j] = pow5(state[j])
    const off = (R_F / 2 + 1) * t + nRoundsP + r * t
    for (let j = 0; j < t; j++) state[j] = addMod(state[j], c[off + j])
    state = mixVec(m, state, t)
  }

  // Final sigma + MixLast column 0: out = sum_j M[j][0] * state[j].
  for (let j = 0; j < t; j++) state[j] = pow5(state[j])
  let out = 0n
  for (let j = 0; j < t; j++) {
    out = addMod(out, mulMod(m[j][0], state[j]))
  }
  return out
}
