import type * as React from "react"

import { Button } from "@/components/ui/button"

import type { WalletProvider } from "@/app/_constants/account"

type WalletProviderButtonProps = {
  disabled?: boolean
  onConnect: (provider: WalletProvider) => Promise<void> | void
  pending?: boolean
  provider: WalletProvider
}

export function WalletProviderButton({
  disabled = false,
  onConnect,
  pending = false,
  provider,
}: WalletProviderButtonProps): React.ReactElement {
  const Icon = provider.icon

  return (
    <Button
      className="after:flex-1 hover:brightness-90"
      disabled={disabled}
      onClick={() => {
        void onConnect(provider)
      }}
      // brandColor/brandForeground come from data (app/_constants/account.ts),
      // not fixed per-component classes — Tailwind's JIT scanner only
      // picks up literal bg-[#..] strings in source, not ones built at
      // runtime, so this has to be an inline style rather than an
      // arbitrary-value class.
      style={{ backgroundColor: provider.brandColor, color: provider.brandForeground }}
      type="button"
      variant="link"
    >
      <span className="pointer-events-none me-2 flex-1">
        <Icon aria-hidden="true" className="opacity-70" />
      </span>
      {pending ? "Connecting..." : `Connect with ${provider.name}`}
    </Button>
  )
}
