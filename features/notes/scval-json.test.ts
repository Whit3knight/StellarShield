import { describe, expect, it } from "vitest"

import { scValToNative, xdr } from "@stellar/stellar-sdk"

import { scValJsonToBase64 } from "./scval-json"

const native = (b64: string) => scValToNative(xdr.ScVal.fromXDR(b64, "base64"))

describe("scValJsonToBase64", () => {
  it("converts the topic shapes Goldsky delivers", () => {
    const b64 = scValJsonToBase64({ symbol: "borrow" })
    expect(b64).toBeTruthy()
    expect(native(b64!)).toBe("borrow")
  })

  it("converts a real borrow event body (vec of u64 + bytes)", () => {
    // Trimmed from a live Neon row written by the Goldsky pipeline.
    const leaf =
      "3705f8131ab6c503547718e7801df88cd8da1597176c229101cb79913ab5901a"
    const body = {
      vec: [
        { u64: "1" },
        {
          bytes:
            "73e8ef085d48c5ed0f7a2b2e77d6162ff10c38cf9f86341e2f6ef18806d2008f",
        },
        { bytes: leaf },
        { bytes: "c0de024c" },
        {
          bytes:
            "346f2769373114b7c89edda1ea39bcfbf15fa5189dd7ec8447ea592e6d262aa3",
        },
      ],
    }
    const b64 = scValJsonToBase64(body)
    expect(b64).toBeTruthy()
    const decoded = native(b64!) as unknown[]
    expect(decoded).toHaveLength(5)
    expect(decoded[0]).toBe(1n)
    expect(Buffer.from(decoded[2] as Uint8Array).toString("hex")).toBe(leaf)
  })

  it("converts addresses", () => {
    const account = "GCGLOK2DM2Y4NGESNJBTTOHEY7EB3MO35FV5YQSZIOWV6QW6ZNRXGPXK"
    const b64 = scValJsonToBase64({ address: account })
    expect(b64).toBeTruthy()
    expect(native(b64!)).toBe(account)
  })

  it("returns null for unknown kinds and malformed input", () => {
    expect(scValJsonToBase64({ mystery: 1 })).toBeNull()
    expect(scValJsonToBase64({ vec: [{ mystery: 1 }] })).toBeNull()
    expect(scValJsonToBase64("plain-string")).toBeNull()
    expect(scValJsonToBase64(42)).toBeNull()
  })
})
