import { describe, expect, it } from "vitest"

import {
  backupBundleToDownload,
  decodeNotesBackup,
  encodeNotesBackup,
  parseBackupJson,
} from "./backup"
import type { ShieldedNote } from "./note"
import type { ScanIdentity } from "./scanner"

function makeIdentity(fillByte: number): ScanIdentity {
  const secretKey = new Uint8Array(32).fill(fillByte)
  const publicKey = new Uint8Array(32).fill(fillByte ^ 0xff)
  return { publicKey, secretKey, skField: 42n }
}

const SAMPLE_NOTES: ShieldedNote[] = [
  {
    amount: 100n,
    asset: "XLM",
    index: 0,
    salt: 12345n,
    sk: 7n,
    tree: "deposit",
    openedAt: 1_800_000_000,
  },
  {
    amount: 60n,
    asset: "USDC",
    index: 3,
    salt: 99n,
    sk: 7n,
    tree: "loan",
    openedAt: 1_800_000_100,
    bond: {
      saltAmount: 1n,
      saltValue: 2n,
      saltPrice: 3n,
      collateralValue: 400n,
      borrowPrice: 8n,
    },
  },
]

describe("notes backup", () => {
  it("round-trips notes via encrypt/decrypt", () => {
    const identity = makeIdentity(0x11)
    const bundle = encodeNotesBackup(SAMPLE_NOTES, identity, 1_800_001_000)
    const restored = decodeNotesBackup(bundle, identity)
    expect(restored).toEqual(SAMPLE_NOTES)
  })

  it("fails with a different wallet identity", () => {
    const identityA = makeIdentity(0x22)
    const identityB = makeIdentity(0x33)
    const bundle = encodeNotesBackup(SAMPLE_NOTES, identityA, 42)
    expect(() => decodeNotesBackup(bundle, identityB)).toThrow()
  })

  it("rejects tampered ciphertext", () => {
    const identity = makeIdentity(0x44)
    const bundle = encodeNotesBackup(SAMPLE_NOTES, identity, 99)
    const bytes = Uint8Array.from(atob(bundle.ciphertext), (c) => c.charCodeAt(0))
    bytes[0] ^= 0xff
    let bin = ""
    for (const b of bytes) bin += String.fromCharCode(b)
    const tampered = { ...bundle, ciphertext: btoa(bin) }
    expect(() => decodeNotesBackup(tampered, identity)).toThrow()
  })

  it("rejects a bundle with unknown magic", () => {
    const identity = makeIdentity(0x55)
    const bundle = encodeNotesBackup(SAMPLE_NOTES, identity, 0)
    expect(() =>
      decodeNotesBackup(
        { ...bundle, magic: "not-stellar-shield" as never },
        identity
      )
    ).toThrow(/magic/i)
  })

  it("parseBackupJson round-trips through JSON", () => {
    const identity = makeIdentity(0x66)
    const bundle = encodeNotesBackup(SAMPLE_NOTES, identity, 7)
    const download = backupBundleToDownload(bundle)
    expect(download.mime).toBe("application/json")
    const roundTrip = parseBackupJson(download.body)
    expect(decodeNotesBackup(roundTrip, identity)).toEqual(SAMPLE_NOTES)
  })

  it("parseBackupJson rejects unrelated payloads", () => {
    expect(() => parseBackupJson('{"foo": 1}')).toThrow()
  })
})
