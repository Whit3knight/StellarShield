import { describe, expect, it } from "vitest"

import { deriveShieldedIdentity, encryptMemo, tryDecryptMemo } from "./memo"
import { legacyIdentityFromAddress } from "./use-shielded-identity"

const ADDRESS = "GCGLOK2DM2Y4NGESNJBTTOHEY7EB3MO35FV5YQSZIOWV6QW6ZNRXGPXK"

async function sha256(input: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(input)
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))
}

describe("R1 legacy identity backward compatibility", () => {
  it("reproduces the exact pre-migration address-derived identity", async () => {
    // Old notes were minted under deriveShieldedIdentity(SHA-256(
    // "stellar-shield:" + address)). If this ever drifts, those notes
    // become undecryptable and unspendable — so pin it.
    const legacy = await legacyIdentityFromAddress(ADDRESS)
    const expected = deriveShieldedIdentity(await sha256(`stellar-shield:${ADDRESS}`))
    expect(legacy.publicKey).toEqual(expected.publicKey)
    expect(legacy.secretKey).toEqual(expected.secretKey)
  })

  it("still decrypts a memo minted under the legacy identity", async () => {
    const legacy = await legacyIdentityFromAddress(ADDRESS)
    const plaintext = {
      amount: "100",
      asset: "XLM",
      index: 2,
      salt: "17",
      tree: "deposit" as const,
    }
    const bundle = encryptMemo({ plaintext, recipientPk: legacy.publicKey })
    expect(tryDecryptMemo({ bundle, recipientSk: legacy.secretKey })).toEqual(
      plaintext
    )
  })

  it("derives distinct identities per address", async () => {
    const a = await legacyIdentityFromAddress(ADDRESS)
    const b = await legacyIdentityFromAddress(
      "GABC7XY7L3ROVTS3AJHUUJEC6GT5N7O5NL5FWZ3WQ4B2AWFDHRZJ3ZQY"
    )
    expect(a.publicKey).not.toEqual(b.publicKey)
  })

  it("a signature-derived seed yields a different identity than the address", async () => {
    // The R1 fix: identity comes from a signature (secret), not the
    // public address, so the two must not coincide.
    const addressId = deriveShieldedIdentity(
      await sha256(`stellar-shield:${ADDRESS}`)
    )
    const signatureId = deriveShieldedIdentity(
      await sha256("a-freighter-signature-over-the-canonical-message")
    )
    expect(signatureId.publicKey).not.toEqual(addressId.publicKey)
  })
})
