// JSON-safe note (de)serialisation used by the localStorage
// persistence in note-store.

import type { ShieldedNote } from "./note"

export type SerializedNote = {
  amount: string
  asset: string
  index: number
  salt: string
  sk: string
  tree: string
  openedAt?: number
  spent?: boolean
  bond?: {
    saltAmount: string
    saltValue: string
    saltPrice: string
    collateralValue: string
    borrowPrice: string
    collateralAsset?: string
  }
  witness?: {
    pathElements: string[]
    pathBits: number[]
    root: string
  }
}

export function serializeNote(note: ShieldedNote): SerializedNote {
  return {
    amount: note.amount.toString(),
    asset: note.asset,
    index: note.index,
    salt: note.salt.toString(),
    sk: note.sk.toString(),
    tree: note.tree,
    openedAt: note.openedAt,
    spent: note.spent,
    bond: note.bond
      ? {
          saltAmount: note.bond.saltAmount.toString(),
          saltValue: note.bond.saltValue.toString(),
          saltPrice: note.bond.saltPrice.toString(),
          collateralValue: note.bond.collateralValue.toString(),
          borrowPrice: note.bond.borrowPrice.toString(),
          collateralAsset: note.bond.collateralAsset,
        }
      : undefined,
    witness: note.witness
      ? {
          pathElements: note.witness.pathElements.map((v) => v.toString()),
          pathBits: note.witness.pathBits,
          root: note.witness.root.toString(),
        }
      : undefined,
  }
}

export function deserializeNote(row: SerializedNote): ShieldedNote {
  if (row.tree !== "deposit" && row.tree !== "loan") {
    throw new Error(`note-serde: unknown note tree "${row.tree}"`)
  }
  const asset = row.asset
  if (asset !== "XLM" && asset !== "USDC" && asset !== "EURC") {
    throw new Error(`note-serde: unsupported asset "${row.asset}"`)
  }
  return {
    amount: BigInt(row.amount),
    asset,
    index: row.index,
    salt: BigInt(row.salt),
    sk: BigInt(row.sk),
    tree: row.tree,
    openedAt: row.openedAt,
    spent: row.spent,
    bond: row.bond
      ? {
          saltAmount: BigInt(row.bond.saltAmount),
          saltValue: BigInt(row.bond.saltValue),
          saltPrice: BigInt(row.bond.saltPrice),
          collateralValue: BigInt(row.bond.collateralValue),
          borrowPrice: BigInt(row.bond.borrowPrice),
          collateralAsset:
            row.bond.collateralAsset === "XLM" ||
            row.bond.collateralAsset === "USDC" ||
            row.bond.collateralAsset === "EURC"
              ? row.bond.collateralAsset
              : undefined,
        }
      : undefined,
    witness: row.witness
      ? {
          pathElements: row.witness.pathElements.map((v) => BigInt(v)),
          pathBits: row.witness.pathBits,
          root: BigInt(row.witness.root),
        }
      : undefined,
  }
}
