import { describe, expect, it } from "vitest"

import {
  bigintTo32Bytes,
  encodeG1,
  encodeG2,
  structureProof,
} from "./proof-encoding"

const FP_BYTES = 48

function hexOf(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

describe("bigintTo32Bytes", () => {
  it("emits big-endian bytes matching the input", () => {
    expect(hexOf(bigintTo32Bytes(0n))).toBe("00".repeat(32))
    expect(hexOf(bigintTo32Bytes(1n))).toBe("00".repeat(31) + "01")
    expect(hexOf(bigintTo32Bytes(0xabcdn))).toBe("00".repeat(30) + "abcd")
  })

  it("wraps low 256 bits when the value exceeds 32 bytes", () => {
    const big = (1n << 256n) - 1n
    expect(hexOf(bigintTo32Bytes(big))).toBe("ff".repeat(32))
  })
})

describe("encodeG1", () => {
  it("packs x || y in big-endian 48-byte slots", () => {
    const bytes = encodeG1(["1", "2", "1"])
    expect(bytes.length).toBe(FP_BYTES * 2)
    expect(hexOf(bytes.slice(0, FP_BYTES))).toBe("00".repeat(47) + "01")
    expect(hexOf(bytes.slice(FP_BYTES))).toBe("00".repeat(47) + "02")
  })

  it("flags the infinity point when z==0", () => {
    const bytes = encodeG1(["0", "0", "0"])
    expect(bytes[0]).toBe(0x40)
    expect(bytes.slice(1).every((b) => b === 0)).toBe(true)
  })
})

describe("encodeG2", () => {
  it("uses Soroban's c1-first order (X_c1 || X_c0 || Y_c1 || Y_c0)", () => {
    // xC0=1, xC1=2, yC0=3, yC1=4 → wire bytes = 2 || 1 || 4 || 3.
    const bytes = encodeG2([
      ["1", "2"],
      ["3", "4"],
      ["1", "0"],
    ])
    expect(bytes.length).toBe(FP_BYTES * 4)
    const slots = [0, FP_BYTES, FP_BYTES * 2, FP_BYTES * 3].map((offset) =>
      hexOf(bytes.slice(offset, offset + FP_BYTES))
    )
    expect(slots[0]).toBe("00".repeat(47) + "02") // xC1
    expect(slots[1]).toBe("00".repeat(47) + "01") // xC0
    expect(slots[2]).toBe("00".repeat(47) + "04") // yC1
    expect(slots[3]).toBe("00".repeat(47) + "03") // yC0
  })

  it("flags infinity for zPair=(0,0)", () => {
    const bytes = encodeG2([
      ["0", "0"],
      ["0", "0"],
      ["0", "0"],
    ])
    expect(bytes[0]).toBe(0x40)
  })
})

describe("structureProof", () => {
  it("wraps encodeG1 / encodeG2 into (a, b, c)", () => {
    const proof = structureProof({
      pi_a: ["1", "2", "1"],
      pi_b: [
        ["3", "4"],
        ["5", "6"],
        ["1", "0"],
      ],
      pi_c: ["7", "8", "1"],
    })
    expect(proof.a.length).toBe(FP_BYTES * 2)
    expect(proof.b.length).toBe(FP_BYTES * 4)
    expect(proof.c.length).toBe(FP_BYTES * 2)
    // b's first slot must be pi_b[0][1] (c1), i.e. "4".
    expect(hexOf(proof.b.slice(0, FP_BYTES))).toBe("00".repeat(47) + "04")
  })
})
