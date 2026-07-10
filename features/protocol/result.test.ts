import { describe, expect, it } from "vitest"

import {
  contractError,
  formatAdapterError,
  tryParseContractError,
} from "./result"

describe("contractError", () => {
  it("labels every borrow-pool error code with a hint", () => {
    for (const code of [1, 2, 3, 4, 5]) {
      const error = contractError(code)
      expect(error.tag).toBe("ContractError")
      if (error.tag === "ContractError") {
        expect(error.code).toBe(code)
        expect(error.hint).toBeTruthy()
      }
    }
  })

  it("returns a generic label for unknown codes", () => {
    const error = contractError(999)
    expect(error.tag).toBe("ContractError")
    if (error.tag === "ContractError") {
      expect(error.name).toBe("ContractError999")
      expect(error.hint).toBeUndefined()
    }
  })
})

describe("tryParseContractError", () => {
  it("extracts the code from a Soroban Error(Contract, #N) message", () => {
    const parsed = tryParseContractError(
      "HostError: Error(Contract, #5) — proof rejected"
    )
    expect(parsed).not.toBeNull()
    if (parsed && parsed.tag === "ContractError") {
      expect(parsed.code).toBe(5)
      expect(parsed.name).toBe("InvalidProof")
    }
  })

  it("returns null when the message has no contract error marker", () => {
    expect(tryParseContractError("connection refused")).toBeNull()
  })
})

describe("formatAdapterError", () => {
  it("renders ContractError with hint when present", () => {
    const message = formatAdapterError(contractError(5))
    expect(message).toContain("InvalidProof")
    expect(message).toContain("5")
    expect(message).toContain("skeleton")
  })

  it("renders ContractError without hint for unknown codes", () => {
    const message = formatAdapterError(contractError(42))
    expect(message).toBe("ContractError42 (42)")
  })
})
