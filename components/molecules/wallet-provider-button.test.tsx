import { fireEvent, render, screen } from "@testing-library/react"
import { SmartphoneIcon, WalletCardsIcon } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import { WalletProviderButton } from "./wallet-provider-button"

import type { WalletProvider } from "@/app/_constants/account"

const freighter: WalletProvider = {
  icon: WalletCardsIcon,
  id: "freighter",
  name: "Freighter",
}

const walletConnect: WalletProvider = {
  icon: SmartphoneIcon,
  id: "walletconnect",
  name: "WalletConnect",
  unsupported: "Signing needs the Freighter extension.",
}

describe("WalletProviderButton", () => {
  it("connects a supported provider on click", () => {
    const onConnect = vi.fn()
    render(<WalletProviderButton onConnect={onConnect} provider={freighter} />)

    fireEvent.click(
      screen.getByRole("button", { name: /Connect with Freighter/ })
    )
    expect(onConnect).toHaveBeenCalledWith(freighter)
  })

  it("renders an unsupported provider as an inert row, never a button", () => {
    const onConnect = vi.fn()
    render(
      <WalletProviderButton onConnect={onConnect} provider={walletConnect} />
    )

    // No clickable affordance at all — a disabled button would still
    // invite a retry that can never succeed.
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("WalletConnect")).toBeInTheDocument()
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
    expect(
      screen.getByText(/Signing needs the Freighter extension/)
    ).toBeInTheDocument()
    expect(onConnect).not.toHaveBeenCalled()
  })
})
