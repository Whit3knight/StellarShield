export type LifecycleState =
  | "Idle"
  | "Quoting"
  | "Proving"
  | "ProofReady"
  | "ProofFailed"
  | "IntentPending"
  | "Simulating"
  | "Ready"
  | "Signing"
  | "Submitted"
  | "Confirmed"
  | "Failed"
  | "Expired"
  | "Rejected"
  | "Aborted"

export const TERMINAL_STATES: ReadonlySet<LifecycleState> = new Set<LifecycleState>(
  ["Confirmed", "Failed", "Expired", "Rejected", "Aborted"]
)

const TRANSITIONS: Record<LifecycleState, ReadonlySet<LifecycleState>> = {
  Idle: new Set(["Quoting"]),
  Quoting: new Set(["Idle", "Proving"]),
  Proving: new Set(["ProofReady", "ProofFailed", "Aborted"]),
  ProofFailed: new Set(["Quoting", "Idle"]),
  ProofReady: new Set(["IntentPending", "Expired"]),
  IntentPending: new Set(["Simulating", "Expired", "Aborted"]),
  Simulating: new Set(["Ready", "Failed", "Aborted"]),
  Ready: new Set(["Signing", "Expired", "Aborted"]),
  Signing: new Set(["Submitted", "Rejected", "Aborted", "Failed"]),
  Submitted: new Set(["Confirmed", "Failed"]),
  Confirmed: new Set(["Idle"]),
  Failed: new Set(["Idle"]),
  Expired: new Set(["Idle"]),
  Rejected: new Set(["Idle"]),
  Aborted: new Set(["Idle"]),
}

export function isTerminal(state: LifecycleState): boolean {
  return TERMINAL_STATES.has(state)
}

export function canTransition(
  from: LifecycleState,
  to: LifecycleState
): boolean {
  return TRANSITIONS[from].has(to)
}

export function assertTransition(
  from: LifecycleState,
  to: LifecycleState
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal lifecycle transition: ${from} -> ${to}`)
  }
}
