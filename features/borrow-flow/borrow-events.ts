// Tiny module-level pub/sub so the borrow flow can notify unrelated
// surfaces (positions drawer, notification pane) that a confirmation
// landed without threading callbacks through React context. Events
// carry no payload — subscribers pull fresh state via their own hook
// (e.g. `useChainPositions.refresh()`).

const bus =
  typeof window === "undefined"
    ? { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }
    : (new EventTarget() as EventTarget)

const CONFIRMED = "borrow-flow:confirmed"

export function emitBorrowConfirmed(): void {
  bus.dispatchEvent(new Event(CONFIRMED))
}

export function onBorrowConfirmed(handler: () => void): () => void {
  const listener = () => handler()
  bus.addEventListener(CONFIRMED, listener)
  return () => bus.removeEventListener(CONFIRMED, listener)
}
