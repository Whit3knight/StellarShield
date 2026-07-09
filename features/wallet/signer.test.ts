import { afterEach, describe, expect, it, vi } from "vitest"

import { signXdr } from "./signer"

const baseParams = {
  address: "GDU3Z6QKJ2KX3J64P5QBDW6M7Q9Q3EMB4L5PM7KXH4JR6Y9KQ",
  networkPassphrase: "Test SDF Network ; September 2015",
  xdr: "AAAA...base64...",
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe("signXdr", () => {
  it("returns signed XDR from Freighter on the happy path", async () => {
    vi.doMock("@stellar/freighter-api", () => ({
      signTransaction: vi.fn(async () => ({
        signedTxXdr: "SIGNED_XDR",
        signerAddress: baseParams.address,
      })),
    }))

    const result = await signXdr(baseParams)

    expect(result).toEqual({
      ok: true,
      value: {
        signedXdr: "SIGNED_XDR",
        signerAddress: baseParams.address,
      },
    })
  })

  it("maps Freighter user-cancel (code -4) to UserRejected", async () => {
    vi.doMock("@stellar/freighter-api", () => ({
      signTransaction: vi.fn(async () => ({
        signedTxXdr: "",
        signerAddress: "",
        error: { code: -4, message: "User declined access" },
      })),
    }))

    const result = await signXdr(baseParams)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("UserRejected")
      expect(result.error).toMatchObject({ message: "User declined access" })
    }
  })

  it("maps non-browser error (code -3) to InvalidInput", async () => {
    vi.doMock("@stellar/freighter-api", () => ({
      signTransaction: vi.fn(async () => ({
        signedTxXdr: "",
        signerAddress: "",
        error: { code: -3, message: "Not a browser" },
      })),
    }))

    const result = await signXdr(baseParams)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("InvalidInput")
    }
  })

  it("returns Aborted when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await signXdr({ ...baseParams, signal: controller.signal })

    expect(result).toEqual({
      ok: false,
      error: { tag: "Aborted", message: "Signing aborted." },
    })
  })

  it("returns Unknown when WalletConnect provider is requested", async () => {
    const result = await signXdr({ ...baseParams, provider: "walletconnect" })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("Unknown")
      expect(result.error).toMatchObject({ message: expect.stringMatching(/WalletConnect/) })
    }
  })

  it("returns Unknown when Freighter throws", async () => {
    vi.doMock("@stellar/freighter-api", () => ({
      signTransaction: vi.fn(async () => {
        throw new Error("boom")
      }),
    }))

    const result = await signXdr(baseParams)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("Unknown")
      expect(result.error).toMatchObject({ message: "boom" })
    }
  })

  it("returns Unknown when signed XDR is empty and no error is present", async () => {
    vi.doMock("@stellar/freighter-api", () => ({
      signTransaction: vi.fn(async () => ({
        signedTxXdr: "",
        signerAddress: "",
      })),
    }))

    const result = await signXdr(baseParams)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.tag).toBe("Unknown")
    }
  })
})
