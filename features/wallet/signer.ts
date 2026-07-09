import { err, ok, type AdapterResult } from "@/features/protocol"

const FREIGHTER_USER_REJECTED_CODE = -4
const FREIGHTER_NON_BROWSER_CODE = -3

export type SignXdrParams = {
  address: string
  networkPassphrase: string
  provider?: "freighter" | "walletconnect"
  signal?: AbortSignal
  xdr: string
}

export type SignedXdrResult = {
  signedXdr: string
  signerAddress: string
}

export async function signXdr({
  address,
  networkPassphrase,
  provider = "freighter",
  signal,
  xdr,
}: SignXdrParams): Promise<AdapterResult<SignedXdrResult>> {
  if (signal?.aborted) {
    return err({ tag: "Aborted", message: "Signing aborted." })
  }

  if (typeof window === "undefined") {
    return err({
      tag: "InvalidInput",
      message: "signXdr can only run in the browser.",
    })
  }

  if (provider === "walletconnect") {
    return err({
      tag: "Unknown",
      message:
        "signXdr: WalletConnect signing is not yet wired for Soroban ops. Extend features/wallet/signer.ts to dispatch to StellarWalletsKit.signTransaction when the WalletConnect Soroban surface is confirmed.",
    })
  }

  try {
    const { signTransaction } = await import("@stellar/freighter-api")
    const result = await signTransaction(xdr, {
      address,
      networkPassphrase,
    })

    if (signal?.aborted) {
      return err({ tag: "Aborted", message: "Signing aborted." })
    }

    if (result.error) {
      return err(mapFreighterError(result.error))
    }

    if (!result.signedTxXdr) {
      return err({
        tag: "Unknown",
        message: "Freighter returned an empty signed XDR.",
      })
    }

    return ok({
      signedXdr: result.signedTxXdr,
      signerAddress: result.signerAddress ?? address,
    })
  } catch (cause) {
    return err({
      tag: "Unknown",
      message:
        cause instanceof Error
          ? cause.message
          : "Freighter signing threw an unknown error.",
      cause,
    })
  }
}

function mapFreighterError(error: { code?: number; message?: string }): {
  tag: "UserRejected" | "Unknown" | "InvalidInput"
  message: string
} {
  const message = error.message ?? "Freighter signing failed."

  if (error.code === FREIGHTER_USER_REJECTED_CODE) {
    return { tag: "UserRejected", message }
  }

  if (error.code === FREIGHTER_NON_BROWSER_CODE) {
    return {
      tag: "InvalidInput",
      message: "Freighter is only available in a browser environment.",
    }
  }

  return { tag: "Unknown", message }
}
