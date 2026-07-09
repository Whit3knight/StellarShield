export function createStableFlowId(
  prefix: string,
  ...parts: Array<number | string>
): string {
  const input = parts.join("|")
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }

  return `${prefix}-${hash.toString(36).padStart(7, "0")}`
}
