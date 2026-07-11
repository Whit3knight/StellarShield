import { describe, expect, it } from "vitest"

import {
  assetTag,
  computeCommitment,
  computeNullifier,
  DENOMINATION,
  randomFieldElement,
  SUPPORTED_ASSETS,
} from "./note"
import {
  decodeMemoBundle,
  deriveShieldedIdentity,
  encodeMemoBundle,
  encryptMemo,
  tryDecryptMemo,
} from "./memo"

describe("shielded note primitives", () => {
  it("assetTag is stable per supported asset", () => {
    expect(assetTag("XLM")).toBe(0n)
    expect(assetTag("USDC")).toBe(1n)
    expect(assetTag("EURC")).toBe(2n)
  })

  it("assetTag rejects unknown assets", () => {
    expect(() => assetTag("BTC" as (typeof SUPPORTED_ASSETS)[number])).toThrow()
  })

  it("computes deterministic commitments for identical inputs", async () => {
    const params = {
      amount: 100n,
      asset: "XLM" as const,
      salt: 42n,
      sk: 7n,
    }
    const first = await computeCommitment(params)
    const second = await computeCommitment(params)
    expect(first).toBe(second)
  })

  it("commitment changes when any input changes", async () => {
    const base = {
      amount: 100n,
      asset: "XLM" as const,
      salt: 1n,
      sk: 1n,
    }
    const baseline = await computeCommitment(base)
    expect(await computeCommitment({ ...base, amount: 101n })).not.toBe(
      baseline
    )
    expect(await computeCommitment({ ...base, salt: 2n })).not.toBe(baseline)
    expect(await computeCommitment({ ...base, sk: 2n })).not.toBe(baseline)
    expect(
      await computeCommitment({ ...base, asset: "USDC" })
    ).not.toBe(baseline)
  })

  it("nullifier is deterministic per (sk, index)", async () => {
    const first = await computeNullifier(9n, 4)
    const second = await computeNullifier(9n, 4)
    expect(first).toBe(second)
    expect(await computeNullifier(9n, 5)).not.toBe(first)
    expect(await computeNullifier(10n, 4)).not.toBe(first)
  })

  it("DENOMINATION covers every supported asset", () => {
    for (const asset of SUPPORTED_ASSETS) {
      expect(DENOMINATION[asset]).toBeGreaterThan(0n)
    }
  })

  it("randomFieldElement returns values inside BLS12-381 Fr order", () => {
    const FR_ORDER =
      0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n
    for (let index = 0; index < 20; index++) {
      const value = randomFieldElement()
      expect(value).toBeGreaterThanOrEqual(0n)
      expect(value).toBeLessThan(FR_ORDER)
    }
  })
})

describe("encrypted memo round-trip", () => {
  it("recipient decrypts a memo addressed to them", () => {
    const seed = new Uint8Array(32).fill(0x11)
    const { publicKey, secretKey } = deriveShieldedIdentity(seed)

    const plaintext = {
      amount: "100",
      asset: "XLM",
      index: 3,
      salt: "42",
      tree: "deposit" as const,
    }

    const bundle = encryptMemo({ plaintext, recipientPk: publicKey })
    const decoded = tryDecryptMemo({ bundle, recipientSk: secretKey })
    expect(decoded).toEqual(plaintext)
  })

  it("wrong recipient gets null (auth tag mismatch)", () => {
    const seedA = new Uint8Array(32).fill(0x11)
    const seedB = new Uint8Array(32).fill(0x22)
    const identityA = deriveShieldedIdentity(seedA)
    const identityB = deriveShieldedIdentity(seedB)

    const bundle = encryptMemo({
      plaintext: {
        amount: "10",
        asset: "USDC",
        index: 0,
        salt: "1",
        tree: "loan",
      },
      recipientPk: identityA.publicKey,
    })
    expect(
      tryDecryptMemo({ bundle, recipientSk: identityB.secretKey })
    ).toBeNull()
  })

  it("encode + decode preserves the memo bundle", () => {
    const seed = new Uint8Array(32).fill(0x33)
    const { publicKey, secretKey } = deriveShieldedIdentity(seed)
    const plaintext = {
      amount: "10",
      asset: "EURC",
      index: 7,
      salt: "99",
      tree: "loan" as const,
    }
    const bundle = encryptMemo({ plaintext, recipientPk: publicKey })
    const encoded = encodeMemoBundle(bundle)
    const roundTrip = decodeMemoBundle(encoded)
    expect(roundTrip).not.toBeNull()
    if (!roundTrip) return
    const decrypted = tryDecryptMemo({
      bundle: roundTrip,
      recipientSk: secretKey,
    })
    expect(decrypted).toEqual(plaintext)
  })

  it("deriveShieldedIdentity is deterministic per seed", () => {
    const seed = new Uint8Array(32).fill(0x44)
    const identityA = deriveShieldedIdentity(seed)
    const identityB = deriveShieldedIdentity(seed)
    expect(identityA.publicKey).toEqual(identityB.publicKey)
    expect(identityA.secretKey).toEqual(identityB.secretKey)
  })
})
