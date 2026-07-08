import type * as React from "react"

import { Button } from "@/components/ui/button"

import type { WalletProvider } from "@/app/_constants/account"

type WalletProviderButtonProps = {
  disabled?: boolean
  onConnect: (provider: WalletProvider) => Promise<void> | void
  pending?: boolean
  provider: WalletProvider
}

function getWalletProviderButtonClass(provider: WalletProvider): string {
  if (provider.id === "walletconnect") {
    return "bg-[#3B99FC] text-white after:flex-1 hover:bg-[#3B99FC]/90"
  }

  return "bg-[#111827] text-white after:flex-1 hover:bg-[#111827]/90"
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
      className={getWalletProviderButtonClass(provider)}
      disabled={disabled}
      onClick={() => {
        void onConnect(provider)
      }}
      type="button"
      variant="link"
    >
      <span className="pointer-events-none me-2 flex-1">
        <Icon aria-hidden="true" className="opacity-60" />
      </span>
      {pending ? "Connecting..." : `Connect with ${provider.name}`}
    </Button>
  )
}
