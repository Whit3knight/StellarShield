// Encrypted note-store backup. Serialises the current note inventory
// into a JSON blob, seals it with a symmetric key derived from the
// wallet's shielded identity, and produces a base64 bundle safe to
// download / paste around. Import reverses the pipeline and merges
// back into the note store.
//
// Purpose: cross-device recovery without an indexer. Public RPCs drop
// events past ~24h; the on-chain commitments live forever but the
// memo openings needed to spend them do not. Whoever holds the
// backup blob + the matching wallet can re-materialise the full note
// inventory anywhere.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js"
import { sha256 } from "@noble/hashes/sha2.js"

import type { ScanIdentity } from "./scanner"
import type { ShieldedNote } from "./note"
import { upsertNote } from "./note-store"

const BACKUP_VERSION = 1
const BACKUP_MAGIC = "stellar-shield-notes"
const NONCE_BYTES = 12

type SerializedNote = {
  amount: string
  asset: string
  index: number
  salt: string
  sk: string
  tree: string
  openedAt?: number
  bond?: {
    saltAmount: string
    saltValue: string
    saltPrice: string
    collateralValue: string
    borrowPrice: string
  }
}

type BackupPayload = {
  magic: typeof BACKUP_MAGIC
  version: number
  createdAt: number
  notes: SerializedNote[]
}

type BackupBundle = {
  magic: typeof BACKUP_MAGIC
  version: number
  nonce: string // base64
  ciphertext: string // base64
}

/**
 * Build the symmetric key ChaCha20 uses. Same identity → same key,
 * so any device that can reconstruct the shielded identity (i.e. any
 * device with the wallet) can decrypt.
 */
function deriveBackupKey(identity: ScanIdentity): Uint8Array {
  const domain = new TextEncoder().encode("stellar-shield:notes-backup:v1")
  const merged = new Uint8Array(identity.secretKey.length + domain.length)
  merged.set(identity.secretKey, 0)
  merged.set(domain, identity.secretKey.length)
  return sha256(merged)
}

function serializeNote(note: ShieldedNote): SerializedNote {
  return {
    amount: note.amount.toString(),
    asset: note.asset,
    index: note.index,
    salt: note.salt.toString(),
    sk: note.sk.toString(),
    tree: note.tree,
    openedAt: note.openedAt,
    bond: note.bond
      ? {
          saltAmount: note.bond.saltAmount.toString(),
          saltValue: note.bond.saltValue.toString(),
          saltPrice: note.bond.saltPrice.toString(),
          collateralValue: note.bond.collateralValue.toString(),
          borrowPrice: note.bond.borrowPrice.toString(),
        }
      : undefined,
  }
}

function deserializeNote(row: SerializedNote): ShieldedNote {
  if (row.tree !== "deposit" && row.tree !== "loan") {
    throw new Error(`backup: unknown note tree "${row.tree}"`)
  }
  const asset = row.asset
  if (asset !== "XLM" && asset !== "USDC" && asset !== "EURC") {
    throw new Error(`backup: unsupported asset "${row.asset}"`)
  }
  return {
    amount: BigInt(row.amount),
    asset,
    index: row.index,
    salt: BigInt(row.salt),
    sk: BigInt(row.sk),
    tree: row.tree,
    openedAt: row.openedAt,
    bond: row.bond
      ? {
          saltAmount: BigInt(row.bond.saltAmount),
          saltValue: BigInt(row.bond.saltValue),
          saltPrice: BigInt(row.bond.saltPrice),
          collateralValue: BigInt(row.bond.collateralValue),
          borrowPrice: BigInt(row.bond.borrowPrice),
        }
      : undefined,
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Encrypt the current note snapshot into a portable bundle.
 */
export function encodeNotesBackup(
  notes: ShieldedNote[],
  identity: ScanIdentity,
  now: number = 0
): BackupBundle {
  const payload: BackupPayload = {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    createdAt: now,
    notes: notes.map(serializeNote),
  }
  const key = deriveBackupKey(identity)
  const nonce = sha256(
    new TextEncoder().encode(
      `${BACKUP_MAGIC}:${identity.publicKey.slice(0, 8).join(",")}:${now}`
    )
  ).slice(0, NONCE_BYTES)
  const cipher = chacha20poly1305(key, nonce)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = cipher.encrypt(plaintext)
  return {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
  }
}

/**
 * Decrypt a bundle. Throws if magic / version don't match, if the
 * ChaCha20 auth tag fails, or if the inner JSON is malformed.
 */
export function decodeNotesBackup(
  bundle: BackupBundle,
  identity: ScanIdentity
): ShieldedNote[] {
  if (bundle.magic !== BACKUP_MAGIC) {
    throw new Error(`backup: unrecognised magic "${bundle.magic}"`)
  }
  if (bundle.version !== BACKUP_VERSION) {
    throw new Error(
      `backup: version ${bundle.version} not supported by this client (expected ${BACKUP_VERSION})`
    )
  }
  const key = deriveBackupKey(identity)
  const nonce = base64ToBytes(bundle.nonce)
  const ciphertext = base64ToBytes(bundle.ciphertext)
  const cipher = chacha20poly1305(key, nonce)
  const plaintext = cipher.decrypt(ciphertext)
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload
  if (parsed.magic !== BACKUP_MAGIC) {
    throw new Error("backup: inner payload magic mismatch")
  }
  return parsed.notes.map(deserializeNote)
}

/**
 * Merge a restored inventory into the local note store. Existing
 * notes with the same `(tree, index)` key are overwritten so backup
 * takes precedence.
 */
export function restoreNotesBackup(notes: ShieldedNote[]): void {
  for (const note of notes) upsertNote(note)
}

/**
 * Convenience: full round trip helpers a UI can wire directly.
 */
export function backupBundleToDownload(bundle: BackupBundle): {
  filename: string
  mime: string
  body: string
} {
  return {
    filename: `stellar-shield-notes-${bundle.nonce.slice(0, 8)}.json`,
    mime: "application/json",
    body: JSON.stringify(bundle, null, 2),
  }
}

export function parseBackupJson(raw: string): BackupBundle {
  const parsed = JSON.parse(raw) as Partial<BackupBundle>
  if (
    parsed.magic !== BACKUP_MAGIC ||
    typeof parsed.version !== "number" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("backup: file is not a valid stellar-shield notes bundle")
  }
  return parsed as BackupBundle
}
