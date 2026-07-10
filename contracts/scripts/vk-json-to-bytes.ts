/**
 * Convert a snarkjs Groth16 verification_key.json (BLS12-381 curve) into
 * raw uncompressed point bytes the borrow-pool contract can embed via
 * `include_bytes!`.
 *
 * BLS12-381 point encoding matches soroban-sdk's G1Affine::from_array /
 * G2Affine::from_array:
 *   G1: 96 bytes  = 48-byte big-endian x || 48-byte big-endian y
 *   G2: 192 bytes = (48-byte x_c0 || 48-byte x_c1) || (48-byte y_c0 || 48-byte y_c1)
 * The Fp2 element ordering (c0 first) matches ark_bls12_381::Fq2::new(c0, c1).
 *
 * Usage:
 *   bun contracts/scripts/vk-json-to-bytes.ts \
 *     public/circuits-circom/verification_key.json \
 *     contracts/borrow-pool/src/vk
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

const FP_BYTES = 48

function encodeFp(decimal: string): Uint8Array {
  let value = BigInt(decimal)
  const out = new Uint8Array(FP_BYTES)
  for (let index = FP_BYTES - 1; index >= 0; index--) {
    out[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return out
}

// BLS12-381 uncompressed encoding flags. Bit 1 of byte 0 = infinity.
// The whole 96/192-byte buffer must be zero except that one flag bit.
const INFINITY_BYTE = 0x40

function encodeG1(coords: [string, string, string]): Uint8Array {
  const [x, y, z] = coords
  const out = new Uint8Array(FP_BYTES * 2)
  if (z === "0") {
    out[0] = INFINITY_BYTE
    return out
  }
  if (z !== "1") {
    throw new Error(
      `encodeG1: projective z != 0/1 not supported (need affine normalisation): got ${z}`
    )
  }
  out.set(encodeFp(x), 0)
  out.set(encodeFp(y), FP_BYTES)
  return out
}

function encodeG2(coords: [[string, string], [string, string], [string, string]]): Uint8Array {
  const [[x0, x1], [y0, y1], [z0, z1]] = coords
  const out = new Uint8Array(FP_BYTES * 4)
  if (z0 === "0" && z1 === "0") {
    out[0] = INFINITY_BYTE
    return out
  }
  if (!(z0 === "1" && z1 === "0")) {
    throw new Error(
      `encodeG2: projective z != (1, 0) not supported: got (${z0}, ${z1})`
    )
  }
  // Soroban G2 order: X_c1 || X_c0 || Y_c1 || Y_c0.
  out.set(encodeFp(x1), 0)
  out.set(encodeFp(x0), FP_BYTES)
  out.set(encodeFp(y1), FP_BYTES * 2)
  out.set(encodeFp(y0), FP_BYTES * 3)
  return out
}

function writeBin(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  console.log(`wrote ${bytes.length}B → ${path}`)
}

const args = process.argv.slice(2)
if (args.length !== 2) {
  console.error(
    "usage: bun contracts/scripts/vk-json-to-bytes.ts <verification_key.json> <output-dir>"
  )
  process.exit(1)
}

const [jsonPath, outDir] = args

const vk = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
  curve: string
  protocol: string
  nPublic: number
  vk_alpha_1: [string, string, string]
  vk_beta_2: [[string, string], [string, string], [string, string]]
  vk_gamma_2: [[string, string], [string, string], [string, string]]
  vk_delta_2: [[string, string], [string, string], [string, string]]
  IC: [string, string, string][]
}

if (vk.curve !== "bls12381") {
  console.error(`unsupported curve ${vk.curve}; expected bls12381`)
  process.exit(1)
}
if (vk.protocol !== "groth16") {
  console.error(`unsupported protocol ${vk.protocol}; expected groth16`)
  process.exit(1)
}

writeBin(join(outDir, "vk_alpha.bin"), encodeG1(vk.vk_alpha_1))
writeBin(join(outDir, "vk_beta.bin"), encodeG2(vk.vk_beta_2))
writeBin(join(outDir, "vk_gamma.bin"), encodeG2(vk.vk_gamma_2))
writeBin(join(outDir, "vk_delta.bin"), encodeG2(vk.vk_delta_2))

vk.IC.forEach((point, index) => {
  writeBin(join(outDir, `vk_ic_${index}.bin`), encodeG1(point))
})

// Manifest so verifier.rs knows the count.
writeFileSync(
  join(outDir, "manifest.txt"),
  `curve=${vk.curve}\nprotocol=${vk.protocol}\nnPublic=${vk.nPublic}\nic_count=${vk.IC.length}\n`
)
console.log(
  `wrote manifest with ${vk.IC.length} IC points, nPublic=${vk.nPublic} → ${join(outDir, "manifest.txt")}`
)

// Prevent unused-var lint on the intentionally-empty basename import.
void basename
