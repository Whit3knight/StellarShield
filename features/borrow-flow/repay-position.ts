import {
  getConfiguredContractId,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

// Submits `repay(account, proof_id)` on the borrow-pool contract via
// the bindings' `signAndSend` path. Signature ceremony mirrors the
// borrow flow: bindings assemble, Freighter signs, RPC submits, we
// wait for the tx hash back.

export type RepayResult =
  | { hash: string; ok: true }
  | { message: string; ok: false }

export async function repayPosition(
  account: string,
  proofIdHex: string,
  signal?: AbortSignal
): Promise<RepayResult> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const contractId = getConfiguredContractId()
  if (!contractId) {
    return { ok: false, message: "Contract not configured." }
  }

  const proofBytes = hexToBytes(proofIdHex)
  if (!proofBytes || proofBytes.length !== 32) {
    return { ok: false, message: "Invalid proof id." }
  }

  const bindings = await import("@/features/protocol/bindings/borrow-pool")
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  const client = new bindings.Client({
    contractId,
    networkPassphrase: getConfiguredNetworkPassphrase(),
    rpcUrl: getConfiguredSorobanRpcUrl(),
    publicKey: account,
  })

  let assembled
  try {
    assembled = await client.repay({
      account,
      proof_id: Buffer.from(proofBytes),
    })
  } catch (cause) {
    return {
      ok: false,
      message: formatError(cause, "Failed to assemble repay transaction."),
    }
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  try {
    const { signTransaction } = await import("@stellar/freighter-api")
    const sent = await assembled.signAndSend({
      signTransaction: (async (xdrToSign: string, opts?: {
        address?: string
        networkPassphrase?: string
      }) => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
        return signTransaction(xdrToSign, {
          address: opts?.address ?? account,
          networkPassphrase:
            opts?.networkPassphrase ?? getConfiguredNetworkPassphrase(),
        })
      }) as unknown as Parameters<
        typeof assembled.signAndSend
      >[0] extends undefined
        ? never
        : NonNullable<
            Parameters<typeof assembled.signAndSend>[0]
          >["signTransaction"],
    })

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const hash = sent.sendTransactionResponse?.hash
    if (!hash) {
      return { ok: false, message: "Submission returned no hash." }
    }
    return { ok: true, hash }
  } catch (cause) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    return { ok: false, message: formatError(cause, "Repay transaction failed.") }
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) return null

  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    const byte = Number.parseInt(clean.substring(i, i + 2), 16)
    if (Number.isNaN(byte)) return null
    out[i / 2] = byte
  }
  return out
}

function formatError(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message
  return fallback
}
