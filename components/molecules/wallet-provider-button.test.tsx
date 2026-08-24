import { fireEvent, render, screen } from "@testing-library/react"
import { WalletCardsIcon, ZapIcon } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import { WalletProviderButton } from "./wallet-provider-button"

import type { WalletProvider } from "@/app/_constants/account"

const freighter: WalletProvider = {
  icon: WalletCardsIcon,
  id: "freighter",
  name: "Freighter",
}

const xbull: WalletProvider = {
  icon: ZapIcon,
  id: "xbull",
  name: "xBull",
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

  it("connects any provider, not just Freighter", () => {
    const onConnect = vi.fn()
    render(<WalletProviderButton onConnect={onConnect} provider={xbull} />)

    fireEvent.click(screen.getByRole("button", { name: /Connect with xBull/ }))
    expect(onConnect).toHaveBeenCalledWith(xbull)
  })
})
