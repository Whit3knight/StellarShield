export type StableIdPart = boolean | number | string

export function createStableId(
  prefix: string,
  ...parts: Array<StableIdPart>
): string {
  const input = parts.join("|")
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }

  return `${prefix}-${hash.toString(36).padStart(7, "0")}`
}
