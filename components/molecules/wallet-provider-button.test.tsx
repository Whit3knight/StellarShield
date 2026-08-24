import { fireEvent, render, screen } from "@testing-library/react"
import { WalletCardsIcon, ZapIcon } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import { WalletProviderButton } from "./wallet-provider-button"

import type { WalletProvider } from "@/app/_constants/account"

const freighter: WalletProvider = {
  brandColor: "#4a3e99",
  icon: WalletCardsIcon,
  id: "freighter",
  name: "Freighter",
}

const xbull: WalletProvider = {
  brandColor: "#745e97",
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

  it("renders each provider's own brand color, not a shared default", () => {
    render(<WalletProviderButton onConnect={vi.fn()} provider={freighter} />)
    const freighterButton = screen.getByRole("button")
    expect(freighterButton.style.backgroundColor).toBe("rgb(74, 62, 153)")

    render(<WalletProviderButton onConnect={vi.fn()} provider={xbull} />)
    const xbullButton = screen.getByRole("button", { name: /xBull/ })
    expect(xbullButton.style.backgroundColor).toBe("rgb(116, 94, 151)")
  })
})
