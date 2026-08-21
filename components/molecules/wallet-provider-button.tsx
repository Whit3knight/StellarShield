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

  // An unsupported provider renders as an inert row, not a disabled
  // button: a greyed-out button still reads as "try again later", while
  // the real answer is "this will connect and then nothing will work".
  // ponytail: UI-level gate only — `connect()` itself is not guarded, so
  // a programmatic caller can still reach the connector. Gate it there if
  // a second entry point ever appears.
  if (provider.unsupported) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon aria-hidden="true" className="opacity-60" />
          {provider.name}
          <span className="ms-auto text-xs uppercase tracking-wide">
            Unavailable
          </span>
        </p>
        <p className="mt-1 text-xs text-pretty text-muted-foreground">
          {provider.unsupported}
        </p>
      </div>
    )
  }

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
