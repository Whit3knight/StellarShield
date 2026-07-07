"use client"

import { WalletIcon } from "lucide-react"
import * as React from "react"

import { BrandLogo } from "@/components/brand-logo"
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

import {
  getMockConnectedAccount,
  walletProviders,
  type ConnectedAccount,
  type WalletProvider,
} from "../_constants/account"
import { NotificationMenu } from "./notification-menu"
import { UserMenu } from "./user-menu"

function getWalletProviderButtonClass(provider: WalletProvider): string {
  if (provider.id === "walletconnect") {
    return "bg-[#3B99FC] text-white after:flex-1 hover:bg-[#3B99FC]/90"
  }

  return "bg-[#111827] text-white after:flex-1 hover:bg-[#111827]/90"
}

export function WalletNavActions(): React.ReactElement {
  const [account, setAccount] = React.useState<ConnectedAccount | null>(null)
  const [open, setOpen] = React.useState(false)

  const handleConnect = React.useCallback((provider: WalletProvider) => {
    setAccount(getMockConnectedAccount(provider))
    setOpen(false)
  }, [])

  const handleDisconnect = React.useCallback(() => {
    setAccount(null)
  }, [])

  if (!account) {
    return (
      <Dialog onOpenChange={setOpen} open={open}>
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
              {walletProviders.map((wallet) => {
                const Icon = wallet.icon

                return (
                  <Button
                    className={getWalletProviderButtonClass(wallet)}
                    key={wallet.id}
                    onClick={() => {
                      handleConnect(wallet)
                    }}
                  >
                    <span className="pointer-events-none me-2 flex-1">
                      <Icon aria-hidden="true" className="opacity-60" />
                    </span>
                    Connect with {wallet.name}
                  </Button>
                )
              })}
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

  return (
    <>
      <NotificationMenu />
      <UserMenu account={account} onDisconnect={handleDisconnect} />
    </>
  )
}
