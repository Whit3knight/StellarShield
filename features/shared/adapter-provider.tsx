"use client"

import * as React from "react"

import { mockProtocolAdapter, type ProtocolAdapter } from "@/features/protocol"
import {
  mockBorrowProverAdapter,
  type BorrowProverAdapter,
} from "@/features/proofs"

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

export function AdapterProvider({
  children,
  protocol = mockProtocolAdapter,
  prover = mockBorrowProverAdapter,
}: AdapterProviderProps): React.ReactElement {
  const value = React.useMemo<AdapterContextValue>(
    () => ({ protocol, prover }),
    [protocol, prover]
  )

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
