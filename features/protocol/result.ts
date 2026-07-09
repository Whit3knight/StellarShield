export type AdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AdapterError }

export type AdapterError =
  | { tag: "InvalidInput"; field?: string; message: string }
  | { tag: "WalletDisconnected"; message: string }
  | { tag: "UserRejected"; message: string }
  | { tag: "Aborted"; message: string }
  | { tag: "IntentExpired"; intentId: string; expiredAt: string }
  | { tag: "ProofExpired"; proofId: string; expiredAt: string }
  | { tag: "SimulationFailed"; reason: string; details?: unknown }
  | {
      tag: "InsufficientFunds"
      asset: string
      needed: string
      available: string
    }
  | { tag: "Network"; message: string; retriable: boolean }
  | {
      tag: "Timeout"
      phase: "sign" | "submit" | "confirm" | "prove"
      ms: number
    }
  | { tag: "ProofGenerationFailed"; reason: string }
  | { tag: "ProofVerificationFailed"; reason: string }
  | {
      tag: "TransactionFailed"
      hash?: string
      resultCode?: string
      message: string
    }
  | { tag: "Unknown"; message: string; cause?: unknown }

export function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value }
}

export function err<T = never>(error: AdapterError): AdapterResult<T> {
  return { ok: false, error }
}

export function formatAdapterError(error: AdapterError): string {
  switch (error.tag) {
    case "InvalidInput":
      return error.field
        ? `${error.field}: ${error.message}`
        : error.message
    case "InsufficientFunds":
      return `Insufficient ${error.asset}: need ${error.needed}, have ${error.available}.`
    case "IntentExpired":
      return "Borrow intent expired. Restart the flow."
    case "ProofExpired":
      return "Eligibility proof expired. Restart the flow."
    case "SimulationFailed":
      return `Simulation failed: ${error.reason}`
    case "Timeout":
      return `Timed out during ${error.phase} after ${error.ms}ms.`
    case "TransactionFailed":
      return error.resultCode
        ? `Transaction failed (${error.resultCode}): ${error.message}`
        : `Transaction failed: ${error.message}`
    case "ProofGenerationFailed":
      return `Proof generation failed: ${error.reason}`
    case "ProofVerificationFailed":
      return `Proof verification failed: ${error.reason}`
    default:
      return error.message
  }
}
