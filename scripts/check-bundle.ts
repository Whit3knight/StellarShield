import { existsSync, readFileSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

type BuildManifest = {
  pages: Record<string, string[]>
  rootMainFiles?: string[]
}

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const PROJECT_ROOT = process.cwd()
const NEXT_ROOT = join(PROJECT_ROOT, ".next")
const BUILD_MANIFEST_PATH = join(NEXT_ROOT, "build-manifest.json")
const CHUNK_DIR = join(NEXT_ROOT, "static", "chunks")
const PACKAGE_JSON_PATH = join(PROJECT_ROOT, "package.json")

const FREIGHTER_PACKAGE = "@stellar/freighter-api"
const STELLAR_SDK_PACKAGE = "@stellar/stellar-sdk"
const ASYNC_ONLY_PACKAGES = [FREIGHTER_PACKAGE, STELLAR_SDK_PACKAGE]
const FORBIDDEN_PACKAGES = ["radix-ui"]
const ROOT_MAIN_UNCOMPRESSED_CEILING_BYTES = 500_000

async function main(): Promise<void> {
  const failures: string[] = []

  const pkg = JSON.parse(
    readFileSync(PACKAGE_JSON_PATH, "utf-8")
  ) as PackageJson
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

  for (const forbidden of FORBIDDEN_PACKAGES) {
    if (allDeps[forbidden]) {
      failures.push(
        `package.json still lists ${forbidden}; remove it (was replaced by @base-ui/react)`
      )
    }
  }

  if (!existsSync(BUILD_MANIFEST_PATH)) {
    console.log(
      "check-bundle: .next/build-manifest.json missing. Run `bun run build` first, then rerun `bun run check:bundle`."
    )

    if (failures.length > 0) {
      for (const failure of failures) console.error(`  x ${failure}`)
      process.exit(1)
    }

    process.exit(0)
  }

  const manifest = JSON.parse(
    readFileSync(BUILD_MANIFEST_PATH, "utf-8")
  ) as BuildManifest

  const rootChunkFiles = new Set<string>()

  for (const file of manifest.rootMainFiles ?? []) {
    rootChunkFiles.add(file)
  }

  for (const files of Object.values(manifest.pages)) {
    for (const file of files) {
      rootChunkFiles.add(file)
    }
  }

  const rootMainBytes = (manifest.rootMainFiles ?? []).reduce(
    (total, file) => total + statOrZero(join(NEXT_ROOT, file)),
    0
  )

  if (rootMainBytes > ROOT_MAIN_UNCOMPRESSED_CEILING_BYTES) {
    failures.push(
      `root main JS is ${rootMainBytes} bytes (uncompressed), ceiling ${ROOT_MAIN_UNCOMPRESSED_CEILING_BYTES}; investigate the newest addition before shipping`
    )
  }

  const chunkFileNames = await readdir(CHUNK_DIR).catch(() => [] as string[])

  for (const chunkFile of chunkFileNames) {
    if (!chunkFile.endsWith(".js")) continue

    const chunkPath = join(CHUNK_DIR, chunkFile)
    const content = readFileSync(chunkPath, "utf-8")

    for (const asyncPackage of ASYNC_ONLY_PACKAGES) {
      if (!content.includes(asyncPackage)) continue

      const isReferencedAsRoot = Array.from(rootChunkFiles).some((rootFile) =>
        rootFile.endsWith(chunkFile)
      )

      if (isReferencedAsRoot) {
        failures.push(
          `${chunkFile} is a root/page chunk and still bundles ${asyncPackage}; every caller must dynamic-import it`
        )
      }
    }
  }

  if (failures.length > 0) {
    console.error("check-bundle: failures")
    for (const failure of failures) console.error(`  x ${failure}`)
    process.exit(1)
  }

  console.log("check-bundle: ok")
}

function statOrZero(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

main().catch((error) => {
  console.error("check-bundle: crashed", error)
  process.exit(1)
})
