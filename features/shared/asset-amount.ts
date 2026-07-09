import type { SupportedAssetSymbol } from "@/features/markets"

export type AssetAmount = {
  amount: number
  symbol: SupportedAssetSymbol
  valueUsd: number
}
