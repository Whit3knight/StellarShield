"use client"

import type { LucideIcon } from "lucide-react"
import {
  SmartphoneIcon,
  WalletCardsIcon,
  WalletIcon,
} from "lucide-react"
import * as React from "react"

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

import { NotificationMenu } from "./notification-menu"
import { UserMenu } from "./user-menu"

type WalletProvider = {
  icon: LucideIcon
  id: "freighter" | "walletconnect"
  name: string
}

const walletProviders: WalletProvider[] = [
  {
    icon: WalletCardsIcon,
    id: "freighter",
    name: "Freighter",
  },
  {
    icon: SmartphoneIcon,
    id: "walletconnect",
    name: "WalletConnect",
  },
]

export function WalletNavActions(): React.ReactElement {
  const [connected, setConnected] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  const handleConnect = React.useCallback(() => {
    setConnected(true)
    setOpen(false)
  }, [])

  if (!connected) {
    return (
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger render={<Button className="shrink-0" />}>
          <WalletIcon aria-hidden="true" />
          Connect wallet
        </DialogTrigger>
        <DialogPopup className="max-w-sm">
          <DialogHeader className="items-center text-center">
            <div
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border"
            >
              <WalletIcon className="size-5" />
            </div>
            <DialogTitle className="sm:text-center">Connect wallet</DialogTitle>
            <DialogDescription className="sm:text-center">
              Choose how you want to connect to Stellar Shield.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            <div className="space-y-3">
              {walletProviders.map((wallet, index) => {
                const Icon = wallet.icon
                const isPrimary = index === 0

                return (
                  <React.Fragment key={wallet.id}>
                    {index > 0 ? (
                      <div className="flex items-center gap-3 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                        <span className="text-muted-foreground text-xs">
                          Or
                        </span>
                      </div>
                    ) : null}
                    <Button
                      className="w-full"
                      onClick={handleConnect}
                      variant={isPrimary ? "default" : "outline"}
                    >
                      <Icon aria-hidden="true" />
                      Continue with {wallet.name}
                    </Button>
                  </React.Fragment>
                )
              })}
            </div>
            <p className="text-center text-muted-foreground text-xs">
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

  return (
    <>
      <NotificationMenu />
      <UserMenu />
    </>
  )
}
