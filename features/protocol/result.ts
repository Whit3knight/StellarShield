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
  | { tag: "ContractError"; code: number; name: string; hint?: string }
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
    case "ContractError":
      return error.hint
        ? `${error.name} (${error.code}): ${error.hint}`
        : `${error.name} (${error.code})`
    default:
      return error.message
  }
}

/**
 * Map a Soroban contract error code (from the borrow-pool contract) to
 * a labelled AdapterError. Matches `enum Error` in
 * contracts/borrow-pool/src/lib.rs.
 */
export function contractError(code: number): AdapterError {
  switch (code) {
    case 1:
      return {
        tag: "ContractError",
        code,
        name: "IntentExpired",
        hint: "Borrow intent expired before submission. Restart the flow.",
      }
    case 2:
      return {
        tag: "ContractError",
        code,
        name: "ProofReplayed",
        hint: "This proof was already used to open a position.",
      }
    case 3:
      return {
        tag: "ContractError",
        code,
        name: "InvalidAmount",
        hint: "Collateral or borrow amount is zero or negative.",
      }
    case 4:
      return {
        tag: "ContractError",
        code,
        name: "StaleOracle",
        hint: "Oracle epoch is outside the freshness window.",
      }
    case 5:
      return {
        tag: "ContractError",
        code,
        name: "InvalidProof",
        hint: "Contract's verifier rejected the proof. Expected during skeleton — the pairing check is a placeholder until real math lands.",
      }
    default:
      return {
        tag: "ContractError",
        code,
        name: `ContractError${code}`,
      }
  }
}

/**
 * Sniff a Soroban error message for a `Error(Contract, #N)` marker and
 * return the mapped contract error. Falls back to `null` when no
 * contract code is found.
 */
export function tryParseContractError(message: string): AdapterError | null {
  const match = message.match(/Error\(Contract,\s*#(\d+)\)/)
  if (!match) return null
  const code = Number.parseInt(match[1], 10)
  if (!Number.isFinite(code)) return null
  return contractError(code)
}
