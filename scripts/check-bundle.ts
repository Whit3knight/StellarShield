import { existsSync, readFileSync } from "node:fs"
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
const BUILD_MANIFEST_PATH = join(
  PROJECT_ROOT,
  ".next",
  "build-manifest.json"
)
const CHUNK_DIR = join(PROJECT_ROOT, ".next", "static", "chunks")
const PACKAGE_JSON_PATH = join(PROJECT_ROOT, "package.json")

const FREIGHTER_PACKAGE = "@stellar/freighter-api"
const FORBIDDEN_PACKAGES = ["radix-ui"]

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

  const chunkFileNames = await readdir(CHUNK_DIR).catch(() => [] as string[])

  for (const chunkFile of chunkFileNames) {
    if (!chunkFile.endsWith(".js")) continue

    const chunkPath = join(CHUNK_DIR, chunkFile)
    const content = readFileSync(chunkPath, "utf-8")

    if (!content.includes(FREIGHTER_PACKAGE)) continue

    const isReferencedAsRoot = Array.from(rootChunkFiles).some((rootFile) =>
      rootFile.endsWith(chunkFile)
    )

    if (isReferencedAsRoot) {
      failures.push(
        `${chunkFile} is a root/page chunk and still bundles ${FREIGHTER_PACKAGE}; connectFreighter must dynamic-import it`
      )
    }
  }

  if (failures.length > 0) {
    console.error("check-bundle: failures")
    for (const failure of failures) console.error(`  x ${failure}`)
    process.exit(1)
  }

  console.log("check-bundle: ok")
}

main().catch((error) => {
  console.error("check-bundle: crashed", error)
  process.exit(1)
})
