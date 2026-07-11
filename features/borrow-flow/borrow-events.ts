// Tiny module-level pub/sub so the borrow flow can notify unrelated
// surfaces (positions drawer, notification pane) that a chain
// transaction landed without threading callbacks through React
// context. Events carry the tx hash so subscribers can link out;
// consumers pull fresh domain state via their own hooks
// (e.g. `useChainPositions.refresh()`).

const bus: EventTarget =
  typeof window === "undefined"
    ? (new EventTarget() as EventTarget)
    : (new EventTarget() as EventTarget)

const CONFIRMED = "borrow-flow:confirmed"
const REPAY_CONFIRMED = "borrow-flow:repay-confirmed"

type HashDetail = { hash?: string }

export function emitBorrowConfirmed(hash?: string): void {
  bus.dispatchEvent(new CustomEvent(CONFIRMED, { detail: { hash } }))
}

export function onBorrowConfirmed(
  handler: (hash?: string) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<HashDetail>).detail
    handler(detail?.hash)
  }
  bus.addEventListener(CONFIRMED, listener)
  return () => bus.removeEventListener(CONFIRMED, listener)
}

export function emitRepayConfirmed(hash: string): void {
  bus.dispatchEvent(new CustomEvent(REPAY_CONFIRMED, { detail: { hash } }))
}

export function onRepayConfirmed(
  handler: (hash: string) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<HashDetail>).detail
    if (detail?.hash) handler(detail.hash)
  }
  bus.addEventListener(REPAY_CONFIRMED, listener)
  return () => bus.removeEventListener(REPAY_CONFIRMED, listener)
}
