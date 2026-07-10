/**
 * Best-effort prover warm-up. Loads WASM modules + circuit artefacts
 * into memory the moment a wallet connects so the first real
 * `generateBorrowProof` call skips parse + fetch cost.
 *
 * Behaviour depends on the configured prover:
 *   - `noir`    — dynamic-imports `@noir-lang/noir_js` + `@aztec/bb.js`.
 *   - `snarkjs` — dynamic-imports `snarkjs` and fetches the compiled
 *                 Circom WASM + zkey blobs. Blobs cache at module
 *                 scope so every subsequent prove reuses them.
 *
 * Idempotent — repeated calls resolve the same in-flight Promise.
 * Fire-and-forget. Any failure is swallowed silently — the prover
 * itself surfaces errors on real use.
 */

const DEFAULT_SNARKJS_WASM_URL = "/circuits-circom/borrow_eligibility.wasm"
const DEFAULT_SNARKJS_ZKEY_URL = "/circuits-circom/borrow_eligibility.zkey"

type PreloadedSnarkjs = {
  wasm: Uint8Array
  zkey: Uint8Array
}

let inFlight: Promise<void> | null = null
let cachedSnarkjs: PreloadedSnarkjs | null = null
let snarkjsCachePromise: Promise<PreloadedSnarkjs> | null = null

export function preloadProver(): Promise<void> {
  if (inFlight) return inFlight
  if (typeof window === "undefined") return Promise.resolve()

  const prover = process.env.NEXT_PUBLIC_STELLAR_SHIELD_PROVER

  inFlight = (async () => {
    try {
      if (prover === "snarkjs") {
        await preloadSnarkjsPipeline()
      } else if (prover === "noir") {
        await Promise.all([
          import("@noir-lang/noir_js"),
          import("@aztec/bb.js"),
        ])
      }
      // Mock prover has nothing to warm up.
    } catch {
      // Swallow. Preload is optional; the prover reports errors on use.
      inFlight = null
    }
  })()

  return inFlight
}

async function preloadSnarkjsPipeline(): Promise<void> {
  // @ts-expect-error — snarkjs ships no TS types.
  await import("snarkjs")
  await ensureSnarkjsArtefacts()
}

/**
 * Fetch and cache the compiled Circom WASM + Groth16 zkey. Callers can
 * await this to know the artefacts are ready; snarkjs `fullProve`
 * accepts the returned Uint8Array directly.
 */
export function ensureSnarkjsArtefacts(
  urls: { wasmUrl?: string; zkeyUrl?: string } = {}
): Promise<PreloadedSnarkjs> {
  if (cachedSnarkjs) return Promise.resolve(cachedSnarkjs)
  if (snarkjsCachePromise) return snarkjsCachePromise

  const wasmUrl = urls.wasmUrl ?? DEFAULT_SNARKJS_WASM_URL
  const zkeyUrl = urls.zkeyUrl ?? DEFAULT_SNARKJS_ZKEY_URL

  snarkjsCachePromise = (async () => {
    const [wasmBuf, zkeyBuf] = await Promise.all([
      fetchArrayBuffer(wasmUrl),
      fetchArrayBuffer(zkeyUrl),
    ])
    cachedSnarkjs = {
      wasm: new Uint8Array(wasmBuf),
      zkey: new Uint8Array(zkeyBuf),
    }
    snarkjsCachePromise = null
    return cachedSnarkjs
  })()

  return snarkjsCachePromise
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`preload: ${url} → HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

/** Test helper: reset every memoised piece. Not for production paths. */
export function __resetPreloadForTests(): void {
  inFlight = null
  cachedSnarkjs = null
  snarkjsCachePromise = null
}
