// Encrypted note memo attached to every deposit / borrow / repay tx.
// The chain sees random-looking bytes; only the owner (someone who
// knows `sk_wallet`) can decrypt to recover `{ index, salt, amount }`
// and rebuild their note inventory after localStorage loss.
//
// Scheme:
//   1. Ephemeral X25519 keypair per memo → `ephemeral_pk` shipped
//      alongside the ciphertext.
//   2. `shared_secret = X25519(ephemeral_sk, recipient_pk)`
//   3. `key = SHA-256(shared_secret)` → 32-byte key for ChaCha20-Poly1305
//   4. `ciphertext = ChaCha20-Poly1305.encrypt(key, plaintext)` with a
//      deterministic nonce derived from the ephemeral public key.
//
// Recipient scans every deposit / borrow / repay event and re-derives
// the shared secret from `sk_wallet + ephemeral_pk`, then tries to
// decrypt. Successful decrypt = "this note belongs to me".

import { chacha20poly1305 } from "@noble/ciphers/chacha.js"
import { x25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"

export type MemoPlaintext = {
  amount: string // bigint serialised as decimal string
  asset: string
  index: number
  salt: string
  tree: "deposit" | "loan"
  /**
   * Track L bond openings — only present on loan memos issued after the
   * borrow circuit gained bond commitments. Absent = grandfathered
   * non-liquidatable loan.
   */
  bond?: {
    saltAmount: string
    saltValue: string
    saltPrice: string
    collateralValue: string
    oraclePrice: string
  }
}

export type MemoBundle = {
  ciphertext: Uint8Array
  ephemeralPk: Uint8Array
}

/**
 * Encrypt `plaintext` addressed to `recipientPk` (32-byte X25519
 * public key derived from the recipient's `sk`). Returns the ciphertext
 * plus the ephemeral public key needed for decryption.
 */
export function encryptMemo({
  plaintext,
  recipientPk,
}: {
  plaintext: MemoPlaintext
  recipientPk: Uint8Array
}): MemoBundle {
  const ephemeralSk = x25519.utils.randomSecretKey()
  const ephemeralPk = x25519.getPublicKey(ephemeralSk)
  const sharedSecret = x25519.getSharedSecret(ephemeralSk, recipientPk)
  const key = sha256(sharedSecret)
  const nonce = deriveNonce(ephemeralPk)
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext))
  const cipher = chacha20poly1305(key, nonce)
  return { ciphertext: cipher.encrypt(encoded), ephemeralPk }
}

/**
 * Attempt to decrypt a memo with `recipientSk`. Returns `null` if the
 * ciphertext isn't addressed to this recipient (auth tag mismatch).
 */
export function tryDecryptMemo({
  bundle,
  recipientSk,
}: {
  bundle: MemoBundle
  recipientSk: Uint8Array
}): MemoPlaintext | null {
  try {
    const sharedSecret = x25519.getSharedSecret(recipientSk, bundle.ephemeralPk)
    const key = sha256(sharedSecret)
    const nonce = deriveNonce(bundle.ephemeralPk)
    const cipher = chacha20poly1305(key, nonce)
    const decoded = cipher.decrypt(bundle.ciphertext)
    return JSON.parse(new TextDecoder().decode(decoded)) as MemoPlaintext
  } catch {
    return null
  }
}

/**
 * Serialise the memo bundle for on-chain storage. Format:
 *   [32 bytes ephemeral pk][N bytes ciphertext + 16 byte poly1305 tag]
 */
export function encodeMemoBundle(bundle: MemoBundle): Uint8Array {
  const out = new Uint8Array(bundle.ephemeralPk.length + bundle.ciphertext.length)
  out.set(bundle.ephemeralPk, 0)
  out.set(bundle.ciphertext, bundle.ephemeralPk.length)
  return out
}

export function decodeMemoBundle(raw: Uint8Array): MemoBundle | null {
  if (raw.length < 32 + 16) return null
  return {
    ciphertext: raw.slice(32),
    ephemeralPk: raw.slice(0, 32),
  }
}

// Multi-recipient memo (Track L). Same plaintext encrypted independently
// to each recipient — smallest ship for dual-recipient (borrower +
// liquidation-service). Legacy single-recipient bundles decode
// unchanged; the multi format prepends a magic prefix so the two are
// unambiguous.

const MULTI_MAGIC_0 = 0xc0
const MULTI_MAGIC_1 = 0xde

/**
 * Encrypt `plaintext` to every recipient. Anyone holding one of the
 * matching secret keys can decrypt.
 */
export function encryptMemoMulti({
  plaintext,
  recipientPks,
}: {
  plaintext: MemoPlaintext
  recipientPks: Uint8Array[]
}): MemoBundle[] {
  if (recipientPks.length === 0) {
    throw new Error("encryptMemoMulti: at least one recipient required")
  }
  return recipientPks.map((pk) => encryptMemo({ plaintext, recipientPk: pk }))
}

/**
 * Serialise a multi-recipient bundle. Format:
 *   [0xC0][0xDE][count: u8]
 *   for each sub-bundle:
 *     [pk: 32 bytes][ct_len: u16 big-endian][ct]
 */
export function encodeMemoBundleMulti(bundles: MemoBundle[]): Uint8Array {
  if (bundles.length === 0 || bundles.length > 255) {
    throw new Error("encodeMemoBundleMulti: 1..255 sub-bundles required")
  }
  let size = 3
  for (const b of bundles) size += 32 + 2 + b.ciphertext.length
  const out = new Uint8Array(size)
  out[0] = MULTI_MAGIC_0
  out[1] = MULTI_MAGIC_1
  out[2] = bundles.length
  let offset = 3
  for (const b of bundles) {
    out.set(b.ephemeralPk, offset)
    offset += 32
    const ctLen = b.ciphertext.length
    out[offset] = (ctLen >> 8) & 0xff
    out[offset + 1] = ctLen & 0xff
    offset += 2
    out.set(b.ciphertext, offset)
    offset += ctLen
  }
  return out
}

export function decodeMemoBundleMulti(raw: Uint8Array): MemoBundle[] | null {
  if (raw.length < 3) return null
  if (raw[0] !== MULTI_MAGIC_0 || raw[1] !== MULTI_MAGIC_1) return null
  const count = raw[2]
  if (count === 0) return null
  const bundles: MemoBundle[] = []
  let offset = 3
  for (let i = 0; i < count; i++) {
    if (offset + 32 + 2 > raw.length) return null
    const pk = raw.slice(offset, offset + 32)
    offset += 32
    const ctLen = (raw[offset] << 8) | raw[offset + 1]
    offset += 2
    if (offset + ctLen > raw.length) return null
    bundles.push({
      ciphertext: raw.slice(offset, offset + ctLen),
      ephemeralPk: pk,
    })
    offset += ctLen
  }
  if (offset !== raw.length) return null
  return bundles
}

/**
 * Try to decrypt a raw memo (either legacy single-recipient or multi).
 * Returns the first successful open, or null.
 */
export function tryDecryptAnyMemo({
  raw,
  recipientSk,
}: {
  raw: Uint8Array
  recipientSk: Uint8Array
}): MemoPlaintext | null {
  const multi = decodeMemoBundleMulti(raw)
  if (multi) {
    for (const bundle of multi) {
      const opened = tryDecryptMemo({ bundle, recipientSk })
      if (opened) return opened
    }
    return null
  }
  const legacy = decodeMemoBundle(raw)
  if (!legacy) return null
  return tryDecryptMemo({ bundle: legacy, recipientSk })
}

/**
 * Derive an X25519 keypair from a wallet-scoped seed. The wallet
 * signs a canonical message; the signature is fed through SHA-256 to
 * produce a deterministic secret key. Same wallet → same keypair,
 * always.
 */
export function deriveShieldedIdentity(seed: Uint8Array): {
  publicKey: Uint8Array
  secretKey: Uint8Array
} {
  const secretKey = sha256(seed)
  const publicKey = x25519.getPublicKey(secretKey)
  return { publicKey, secretKey }
}

// ChaCha20-Poly1305 needs a 12-byte nonce. Ephemeral pk is unique per
// memo, so taking its first 12 bytes gives a nonce that's unique with
// overwhelming probability (birthday bound ~2^48 memos before collision).
function deriveNonce(ephemeralPk: Uint8Array): Uint8Array {
  return ephemeralPk.slice(0, 12)
}
