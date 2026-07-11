"use client"

import * as React from "react"

import { useAssetPriceRefresher } from "@/features/markets"
import { mockProtocolAdapter, type ProtocolAdapter } from "@/features/protocol"
import { createSorobanProtocolAdapter } from "@/features/protocol/soroban-adapter"
import {
  createSnarkjsBorrowProverAdapter,
  mockBorrowProverAdapter,
  type BorrowProverAdapter,
} from "@/features/proofs"
import {
  getConfiguredContractId,
  getConfiguredHorizonUrl,
  getConfiguredNetworkPassphrase,
  getConfiguredSorobanRpcUrl,
} from "@/features/wallet/network"

export type AdapterContextValue = {
  protocol: ProtocolAdapter
  prover: BorrowProverAdapter
}

const AdapterContext = React.createContext<AdapterContextValue | null>(null)

type AdapterProviderProps = {
  children: React.ReactNode
  protocol?: ProtocolAdapter
  prover?: BorrowProverAdapter
}

function resolveDefaultProverAdapter(): BorrowProverAdapter {
  const prover = process.env.NEXT_PUBLIC_STELLAR_SHIELD_PROVER
  if (prover === "snarkjs") return createSnarkjsBorrowProverAdapter()
  return mockBorrowProverAdapter
}

function resolveDefaultProtocolAdapter(): ProtocolAdapter {
  const shouldUseSoroban =
    process.env.NEXT_PUBLIC_STELLAR_SHIELD_ADAPTER === "soroban"

  if (!shouldUseSoroban) return mockProtocolAdapter

  const contractId = getConfiguredContractId()

  if (!contractId) return mockProtocolAdapter

  return createSorobanProtocolAdapter({
    contractId,
    horizonUrl: getConfiguredHorizonUrl(),
    networkPassphrase: getConfiguredNetworkPassphrase(),
    sorobanRpcUrl: getConfiguredSorobanRpcUrl(),
  })
}

const defaultProtocolAdapter = resolveDefaultProtocolAdapter()
const defaultProverAdapter = resolveDefaultProverAdapter()

export function AdapterProvider({
  children,
  protocol = defaultProtocolAdapter,
  prover = defaultProverAdapter,
}: AdapterProviderProps): React.ReactElement {
  const value = React.useMemo<AdapterContextValue>(
    () => ({ protocol, prover }),
    [protocol, prover]
  )
  useAssetPriceRefresher()

  return (
    <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>
  )
}

export function useAdapters(): AdapterContextValue {
  const value = React.useContext(AdapterContext)

  if (!value) {
    throw new Error("useAdapters must be used within an AdapterProvider")
  }

  return value
}
