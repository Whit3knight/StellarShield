import { WalletIcon } from "lucide-react"
import type * as React from "react"

import { BrandLogo } from "@/components/brand-logo"
import { WalletProviderButton } from "@/components/molecules/wallet-provider-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import type { WalletProvider, WalletProviderId } from "@/app/_constants/account"

type ConnectWalletDialogProps = {
  error?: string | null
  onConnect: (provider: WalletProvider) => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
  pendingProviderId?: WalletProviderId | null
  providers: WalletProvider[]
}

export function ConnectWalletDialog({
  error,
  onConnect,
  onOpenChange,
  open,
  pendingProviderId,
  providers,
}: ConnectWalletDialogProps): React.ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger render={<Button className="shrink-0" />}>
        <WalletIcon aria-hidden="true" />
        Connect wallet
      </DialogTrigger>
      <DialogPopup className="max-w-sm max-sm:mx-3 max-sm:mb-3 max-sm:max-w-[calc(100%-1.5rem)] max-sm:rounded-2xl max-sm:border">
        <DialogHeader className="items-center text-center">
          <BrandLogo
            className="gap-0"
            iconClassName="size-8"
            showText={false}
          />
          <DialogTitle className="sm:text-center">Connect wallet</DialogTitle>
          <DialogDescription className="sm:text-center">
            Choose how you want to connect to Stellar Shield.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <WalletProviderButton
                disabled={pendingProviderId !== null}
                key={provider.id}
                onConnect={onConnect}
                pending={pendingProviderId === provider.id}
                provider={provider}
              />
            ))}
          </div>
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-center text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <p className="text-center text-xs text-muted-foreground">
            By connecting you agree to our{" "}
            <a className="underline hover:no-underline" href="#">
              Terms
            </a>
            .
          </p>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
