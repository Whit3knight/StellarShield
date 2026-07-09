export type Decimal = {
  readonly decimals: number
  readonly value: bigint
}

export function decimal(value: bigint, decimals: number): Decimal {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new Error(`Decimal scale must be a non-negative integer, got ${decimals}`)
  }

  return { decimals, value }
}

export function zero(decimals: number): Decimal {
  return decimal(0n, decimals)
}

export function fromString(input: string, decimals: number): Decimal {
  const cleaned = input.trim().replace(/[^0-9.\-]/g, "")

  if (cleaned === "" || cleaned === "-" || cleaned === ".") {
    return zero(decimals)
  }

  const negative = cleaned.startsWith("-")
  const unsigned = negative ? cleaned.slice(1) : cleaned
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".")
  const whole = wholeRaw === "" ? "0" : wholeRaw
  const truncated = fractionRaw.slice(0, decimals)
  const padded = truncated.padEnd(decimals, "0")
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, "")
  const magnitude = BigInt(combined === "" ? "0" : combined)

  return decimal(negative ? -magnitude : magnitude, decimals)
}

export function fromNumber(value: number, decimals: number): Decimal {
  if (!Number.isFinite(value)) {
    throw new Error(`fromNumber requires a finite value, got ${value}`)
  }

  return fromString(value.toString(), decimals)
}

export function toNumber(value: Decimal): number {
  return Number(toString(value))
}

export function toString(value: Decimal): string {
  const negative = value.value < 0n
  const magnitude = negative ? -value.value : value.value
  const raw = magnitude.toString().padStart(value.decimals + 1, "0")
  const cut = raw.length - value.decimals
  const whole = raw.slice(0, cut)
  const fraction = raw.slice(cut).replace(/0+$/, "")
  const body = fraction === "" ? whole : `${whole}.${fraction}`

  return negative ? `-${body}` : body
}

export function format(
  value: Decimal,
  {
    maxFractionDigits = value.decimals,
    minFractionDigits = 0,
  }: { maxFractionDigits?: number; minFractionDigits?: number } = {}
): string {
  const rescaled = rescale(value, maxFractionDigits)
  const negative = rescaled.value < 0n
  const magnitude = negative ? -rescaled.value : rescaled.value
  const raw = magnitude
    .toString()
    .padStart(rescaled.decimals + 1, "0")
  const cut = raw.length - rescaled.decimals
  const whole = raw.slice(0, cut)
  const fraction = rescaled.decimals === 0 ? "" : raw.slice(cut)
  const stripped = fraction.replace(/0+$/, "")
  const trimmed = stripped.padEnd(minFractionDigits, "0")
  const body = trimmed === "" ? whole : `${whole}.${trimmed}`

  return negative ? `-${body}` : body
}

export function rescale(value: Decimal, decimals: number): Decimal {
  if (decimals === value.decimals) return value

  if (decimals > value.decimals) {
    const factor = 10n ** BigInt(decimals - value.decimals)

    return decimal(value.value * factor, decimals)
  }

  const factor = 10n ** BigInt(value.decimals - decimals)
  const rounded = roundHalfAwayFromZero(value.value, factor)

  return decimal(rounded, decimals)
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.decimals, b.decimals)

  return decimal(rescale(a, scale).value + rescale(b, scale).value, scale)
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.decimals, b.decimals)

  return decimal(rescale(a, scale).value - rescale(b, scale).value, scale)
}

export function mul(a: Decimal, b: Decimal, targetDecimals: number): Decimal {
  const raw = a.value * b.value
  const combined = a.decimals + b.decimals

  return rescale(decimal(raw, combined), targetDecimals)
}

export function div(a: Decimal, b: Decimal, targetDecimals: number): Decimal {
  if (b.value === 0n) {
    throw new Error("Division by zero")
  }

  const extraDecimals = targetDecimals + 1
  const numerator = a.value * 10n ** BigInt(extraDecimals + b.decimals)
  const denominator = b.value * 10n ** BigInt(a.decimals)
  const raw = numerator / denominator

  return rescale(decimal(raw, extraDecimals), targetDecimals)
}

export function mulNumber(
  value: Decimal,
  factor: number,
  targetDecimals: number = value.decimals
): Decimal {
  const PRICE_DECIMALS = 12

  return mul(value, fromNumber(factor, PRICE_DECIMALS), targetDecimals)
}

export function divToNumber(a: Decimal, b: Decimal): number {
  if (b.value === 0n) return 0

  return toNumber(div(a, b, 12))
}

export function isZero(value: Decimal): boolean {
  return value.value === 0n
}

export function gt(a: Decimal, b: Decimal): boolean {
  const scale = Math.max(a.decimals, b.decimals)

  return rescale(a, scale).value > rescale(b, scale).value
}

function roundHalfAwayFromZero(value: bigint, divisor: bigint): bigint {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const quotient = magnitude / divisor
  const remainder = magnitude % divisor
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient

  return negative ? -rounded : rounded
}
