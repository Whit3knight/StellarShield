import { renderHook } from "@testing-library/react"
import type * as React from "react"
import { describe, expect, it, vi } from "vitest"

import {
  mockProtocolAdapter,
  ok,
  type BorrowIntent,
  type ProtocolAdapter,
} from "@/features/protocol"
import {
  mockBorrowProverAdapter,
  type BorrowEligibilityProof,
  type BorrowProverAdapter,
} from "@/features/proofs"

import { AdapterProvider, useAdapters } from "./adapter-provider"

function DefaultProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdapterProvider>{children}</AdapterProvider>
}

describe("AdapterProvider", () => {
  it("injects mock adapters by default", () => {
    const { result } = renderHook(() => useAdapters(), {
      wrapper: DefaultProviderWrapper,
    })

    expect(result.current.protocol).toBe(mockProtocolAdapter)
    expect(result.current.prover).toBe(mockBorrowProverAdapter)
  })

  it("overrides both adapters via props", () => {
    const customIntent = { id: "intent-custom" } as BorrowIntent
    const customProtocol = {
      ...mockProtocolAdapter,
      createBorrowIntent: vi.fn(async () => ok(customIntent)),
    } satisfies ProtocolAdapter
    const customProof = { id: "proof-custom" } as BorrowEligibilityProof
    const customProver = {
      generateBorrowProof: vi.fn(async () => ok(customProof)),
    } satisfies BorrowProverAdapter

    const { result } = renderHook(() => useAdapters(), {
      wrapper: ({ children }) => (
        <AdapterProvider protocol={customProtocol} prover={customProver}>
          {children}
        </AdapterProvider>
      ),
    })

    expect(result.current.protocol).toBe(customProtocol)
    expect(result.current.prover).toBe(customProver)
  })

  it("throws when useAdapters is called without a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => renderHook(() => useAdapters())).toThrow(
      /must be used within an AdapterProvider/
    )

    spy.mockRestore()
  })
})
