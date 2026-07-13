#!/usr/bin/env bun
/**
 * Generate (or --check) the SHA-256 integrity manifest for the circom
 * proving artifacts served from public/circuits-circom. The prover
 * loader (features/shielded-pool/artifacts.ts) hashes each fetched
 * artifact against this manifest and refuses to prove on a mismatch, so
 * a swapped .wasm/.zkey fails loudly instead of silently subverting a
 * proof.
 *
 *   bun scripts/gen-artifact-manifest.ts          # write the manifest
 *   bun scripts/gen-artifact-manifest.ts --check  # exit 1 if it drifted
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const PROJECT_ROOT = process.cwd()
const ARTIFACT_ROOT = join(PROJECT_ROOT, "public", "circuits-circom")
const MANIFEST_PATH = join(
  PROJECT_ROOT,
  "features",
  "shielded-pool",
  "artifact-manifest.json"
)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith(".wasm") || entry.endsWith(".zkey")) out.push(full)
  }
  return out
}

function build(): Record<string, string> {
  const manifest: Record<string, string> = {}
  for (const file of walk(ARTIFACT_ROOT).sort()) {
    // Key by the path after `circuits-circom/`, matching how the loader
    // normalizes both browser (`/circuits-circom/...`) and file:// URLs.
    const key = relative(ARTIFACT_ROOT, file).split("\\").join("/")
    manifest[key] = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex")
  }
  return manifest
}

const manifest = build()
const serialized = JSON.stringify(manifest, null, 2) + "\n"

if (process.argv.includes("--check")) {
  let current = ""
  try {
    current = readFileSync(MANIFEST_PATH, "utf-8")
  } catch {
    console.error(
      "check: artifact-manifest.json missing; run `bun run gen:artifacts`"
    )
    process.exit(1)
  }
  if (current !== serialized) {
    console.error(
      "check: artifact-manifest.json is stale; regenerate with `bun run gen:artifacts` and commit"
    )
    process.exit(1)
  }
  console.log(
    `check: artifact manifest matches (${Object.keys(manifest).length} artifacts)`
  )
} else {
  writeFileSync(MANIFEST_PATH, serialized)
  console.log(
    `wrote ${Object.keys(manifest).length} artifact hashes to ${relative(PROJECT_ROOT, MANIFEST_PATH)}`
  )
}
