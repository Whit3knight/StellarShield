import { describe, expect, it } from "vitest"

import {
  add,
  decimal,
  div,
  divToNumber,
  format,
  fromNumber,
  fromString,
  gt,
  isZero,
  mul,
  mulNumber,
  rescale,
  sub,
  toNumber,
  toString,
  zero,
} from "./money"

describe("money", () => {
  describe("fromString", () => {
    it("parses integers", () => {
      expect(toString(fromString("1000", 7))).toBe("1000")
    })

    it("parses fractional values at asset precision", () => {
      expect(toString(fromString("1.2345678", 7))).toBe("1.2345678")
    })

    it("truncates excess precision without rounding", () => {
      expect(toString(fromString("1.23456789", 7))).toBe("1.2345678")
    })

    it("pads short fractions to full precision internally", () => {
      const d = fromString("0.5", 7)

      expect(d.value).toBe(5_000_000n)
      expect(d.decimals).toBe(7)
    })

    it("treats empty and non-numeric input as zero", () => {
      expect(isZero(fromString("", 7))).toBe(true)
      expect(isZero(fromString("abc", 7))).toBe(true)
      expect(isZero(fromString(".", 7))).toBe(true)
    })

    it("accepts negatives", () => {
      expect(toString(fromString("-1.5", 7))).toBe("-1.5")
    })
  })

  describe("toNumber / toString round-trip", () => {
    it("preserves integer values", () => {
      expect(toNumber(fromString("42", 7))).toBe(42)
    })

    it("preserves fractional values within precision", () => {
      expect(toNumber(fromString("0.0000001", 7))).toBe(0.0000001)
    })
  })

  describe("arithmetic", () => {
    it("adds values at differing scales without float drift", () => {
      const a = fromString("0.1", 7)
      const b = fromString("0.2", 7)

      expect(toString(add(a, b))).toBe("0.3")
    })

    it("subtracts to exact zero", () => {
      const a = fromString("1.0000001", 7)
      const b = fromString("1.0000001", 7)

      expect(isZero(sub(a, b))).toBe(true)
    })

    it("multiplies rescaling to target decimals", () => {
      const amount = fromString("100", 7)
      const priceRatio = fromString("0.5", 4)

      expect(toString(mul(amount, priceRatio, 2))).toBe("50")
    })

    it("divides to a target scale with rounding", () => {
      const a = fromString("1", 7)
      const b = fromString("3", 7)

      expect(toString(div(a, b, 6))).toBe("0.333333")
    })

    it("mulNumber applies a float scalar", () => {
      const amount = fromString("100", 7)

      expect(toString(mulNumber(amount, 0.7, 2))).toBe("70")
    })

    it("divToNumber returns a float ratio", () => {
      const a = fromString("50", 2)
      const b = fromString("200", 2)

      expect(divToNumber(a, b)).toBeCloseTo(0.25, 6)
    })

    it("throws on division by zero", () => {
      expect(() => div(fromString("1", 7), zero(7), 2)).toThrow(/Division by zero/)
    })
  })

  describe("rescale", () => {
    it("upcales by padding", () => {
      const d = fromString("1.5", 2)
      const up = rescale(d, 7)

      expect(up.value).toBe(15_000_000n)
      expect(up.decimals).toBe(7)
    })

    it("downscales with half-away-from-zero rounding", () => {
      expect(toString(rescale(decimal(155n, 3), 2))).toBe("0.16")
      expect(toString(rescale(decimal(-155n, 3), 2))).toBe("-0.16")
      expect(toString(rescale(decimal(154n, 3), 2))).toBe("0.15")
    })
  })

  describe("format", () => {
    it("strips trailing zeros by default", () => {
      expect(format(fromString("1.20", 7))).toBe("1.2")
    })

    it("pads to minFractionDigits", () => {
      expect(format(fromString("1", 7), { minFractionDigits: 2 })).toBe("1.00")
    })

    it("caps maxFractionDigits with rounding", () => {
      expect(format(fromString("1.235", 7), { maxFractionDigits: 2 })).toBe("1.24")
    })

    it("handles zero", () => {
      expect(format(zero(7), { minFractionDigits: 2 })).toBe("0.00")
    })
  })

  describe("comparisons", () => {
    it("gt across different scales", () => {
      expect(gt(fromString("1.5", 7), fromString("1.5", 2))).toBe(false)
      expect(gt(fromString("1.51", 7), fromString("1.5", 2))).toBe(true)
    })
  })

  describe("fromNumber", () => {
    it("bridges float inputs at target precision", () => {
      expect(toString(fromNumber(1.23, 7))).toBe("1.23")
    })

    it("rejects non-finite input", () => {
      expect(() => fromNumber(Infinity, 7)).toThrow()
      expect(() => fromNumber(Number.NaN, 7)).toThrow()
    })
  })
})
