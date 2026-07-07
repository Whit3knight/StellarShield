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

import type { WalletProvider } from "@/app/_constants/account"

type ConnectWalletDialogProps = {
  onConnect: (provider: WalletProvider) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  providers: WalletProvider[]
}

export function ConnectWalletDialog({
  onConnect,
  onOpenChange,
  open,
  providers,
}: ConnectWalletDialogProps): React.ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger render={<Button className="shrink-0" />}>
        <WalletIcon aria-hidden="true" />
        Connect wallet
      </DialogTrigger>
      <DialogPopup className="max-w-sm">
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
                key={provider.id}
                onConnect={onConnect}
                provider={provider}
              />
            ))}
          </div>
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
