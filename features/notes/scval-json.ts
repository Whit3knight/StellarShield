// Converts Goldsky's decoded ScVal JSON (e.g. {"symbol":"deposit"},
// {"vec":[{"u64":"1"},{"bytes":"<hex>"}]}) back into base64 XDR — the
// wire format the client-side event decoders (toScVal in scanner /
// withdraw-tree) already understand. Server-side only; used by the
// /api/events route so the browser keeps a single decode path.
//
// Unknown kinds return null; the caller drops that event, which
// degrades to the RPC-only behavior instead of corrupting anything.

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk"

type ScValJson = Record<string, unknown>

export function scValJsonToBase64(json: unknown): string | null {
  const scVal = toScVal(json)
  return scVal ? scVal.toXDR("base64") : null
}

function toScVal(json: unknown): xdr.ScVal | null {
  if (json === null || json === undefined || json === "void") {
    return xdr.ScVal.scvVoid()
  }
  if (typeof json !== "object" || Array.isArray(json)) return null
  const entries = Object.entries(json as ScValJson)
  if (entries.length !== 1) return null
  const [kind, value] = entries[0]

  try {
    switch (kind) {
      case "symbol":
        return xdr.ScVal.scvSymbol(String(value))
      case "string":
        return xdr.ScVal.scvString(String(value))
      case "bool":
        return xdr.ScVal.scvBool(Boolean(value))
      case "u32":
        return xdr.ScVal.scvU32(Number(value))
      case "i32":
        return xdr.ScVal.scvI32(Number(value))
      case "u64":
      case "i64":
      case "u128":
      case "i128":
      case "u256":
      case "i256":
        return nativeToScVal(BigInt(String(value)), { type: kind })
      case "bytes":
        return xdr.ScVal.scvBytes(Buffer.from(String(value), "hex"))
      case "address":
        return new Address(String(value)).toScVal()
      case "vec": {
        if (!Array.isArray(value)) return null
        const children: xdr.ScVal[] = []
        for (const child of value) {
          const converted = toScVal(child)
          if (!converted) return null
          children.push(converted)
        }
        return xdr.ScVal.scvVec(children)
      }
      case "map": {
        if (!Array.isArray(value)) return null
        const pairs: xdr.ScMapEntry[] = []
        for (const entry of value) {
          const e = entry as { key?: unknown; val?: unknown }
          const key = toScVal(e.key)
          const val = toScVal(e.val)
          if (!key || !val) return null
          pairs.push(new xdr.ScMapEntry({ key, val }))
        }
        return xdr.ScVal.scvMap(pairs)
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
