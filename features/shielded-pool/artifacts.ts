import manifest from "./artifact-manifest.json"

// Integrity-checked loader for the circom proving artifacts. Every prover
// routes wasm/zkey fetches through here so a swapped or corrupted artifact
// (served from public/circuits-circom, no transport integrity of its own)
// fails loudly instead of silently producing a subverted proof over secret
// inputs. Hashes live in artifact-manifest.json — regenerate with
// `bun run gen:artifacts` after intentionally rebuilding a circuit.

const hashes = manifest as Record<string, string>

// Both browser (`/circuits-circom/shielded/...`) and file:// (e2e/CLI) URLs
// share the `circuits-circom/` segment; key the manifest off what follows it.
function artifactKey(url: string): string {
  const marker = "circuits-circom/"
  const at = url.lastIndexOf(marker)
  return at >= 0 ? url.slice(at + marker.length) : url
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function fetchArtefact(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  const buffer = await response.arrayBuffer()

  const key = artifactKey(url)
  const expected = hashes[key]
  if (!expected) {
    throw new Error(
      `artifact ${key} is not in artifact-manifest.json; run \`bun run gen:artifacts\``
    )
  }
  const actual = await sha256Hex(buffer)
  if (actual !== expected) {
    throw new Error(
      `artifact integrity check failed for ${key}: expected ${expected}, got ${actual}`
    )
  }
  return new Uint8Array(buffer)
}
