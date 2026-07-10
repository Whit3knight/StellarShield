/**
 * Best-effort prover warm-up. Loads the Noir + Barretenberg WASM
 * modules into memory so the first real `generateBorrowProof` call
 * skips parse + init cost. Idempotent — repeated calls resolve the
 * same in-flight Promise.
 *
 * Fire-and-forget. Any failure (deps not installed, offline, WASM
 * blocked) is swallowed silently — nothing depends on preload
 * succeeding; the prover itself surfaces errors on real use.
 */

let inFlight: Promise<void> | null = null

export function preloadProver(): Promise<void> {
  if (inFlight) return inFlight
  if (typeof window === "undefined") return Promise.resolve()

  inFlight = (async () => {
    try {
      await Promise.all([
        import("@noir-lang/noir_js"),
        import("@aztec/bb.js"),
      ])
    } catch {
      // Swallow. Preload is optional; the prover reports errors on use.
      inFlight = null
    }
  })()

  return inFlight
}

/** Test helper: reset the memoised Promise. Not for production paths. */
export function __resetPreloadForTests(): void {
  inFlight = null
}
