// Shared BLS12-381 proof-byte encoding for every shielded prover.
//
// Soroban's G1Affine::from_array / G2Affine::from_array expect:
//   G1: 96 bytes  = 48-byte big-endian X || 48-byte big-endian Y
//   G2: 192 bytes = (48-byte X_c1 || 48-byte X_c0) || (48-byte Y_c1 || 48-byte Y_c0)
//
// Matches `contracts/scripts/vk-json-to-bytes.ts` so proof bytes and
// stored verification-key bytes round-trip via the same convention.
// The c1-before-c0 order is the one point that always trips ports —
// keep the tests below green.

const FP_BYTES = 48
const INFINITY_BYTE = 0x40

export function bigintTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let residue = value
  for (let index = 31; index >= 0; index--) {
    out[index] = Number(residue & 0xffn)
    residue >>= 8n
  }
  return out
}

function encodeFp(decimal: string): Uint8Array {
  let value = BigInt(decimal)
  const out = new Uint8Array(FP_BYTES)
  for (let index = FP_BYTES - 1; index >= 0; index--) {
    out[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return out
}

export function encodeG1(pi: string[]): Uint8Array {
  const [x, y, z] = pi
  const out = new Uint8Array(FP_BYTES * 2)
  if (z === "0") {
    out[0] = INFINITY_BYTE
    return out
  }
  out.set(encodeFp(x), 0)
  out.set(encodeFp(y), FP_BYTES)
  return out
}

export function encodeG2(pi: string[][]): Uint8Array {
  const [[xC0, xC1], [yC0, yC1], zPair] = pi
  const out = new Uint8Array(FP_BYTES * 4)
  if (zPair[0] === "0" && zPair[1] === "0") {
    out[0] = INFINITY_BYTE
    return out
  }
  // Soroban G2 order: X_c1 || X_c0 || Y_c1 || Y_c0 (matches
  // vk-json-to-bytes.ts).
  out.set(encodeFp(xC1), 0)
  out.set(encodeFp(xC0), FP_BYTES)
  out.set(encodeFp(yC1), FP_BYTES * 2)
  out.set(encodeFp(yC0), FP_BYTES * 3)
  return out
}

export type StructuredProof = {
  a: Uint8Array
  b: Uint8Array
  c: Uint8Array
}

export function structureProof(proof: {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
}): StructuredProof {
  return {
    a: encodeG1(proof.pi_a),
    b: encodeG2(proof.pi_b),
    c: encodeG1(proof.pi_c),
  }
}
