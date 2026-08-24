"use client"

import { CheckIcon, CopyIcon, ShieldOffIcon } from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MenuItem } from "@/components/ui/menu"
import type { ConnectedAccount } from "@/app/_constants/account"
import { getConfiguredNetworkLabel } from "@/features/wallet/network"

type WalletDetailPanelProps = {
  account: ConnectedAccount
  onForgetDevice: () => void
}

export function WalletDetailPanel({
  account,
  onForgetDevice,
}: WalletDetailPanelProps): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  const networkLabel = getConfiguredNetworkLabel()

  const balanceEntries = account.wallet.balances
    ? Object.entries(account.wallet.balances)
    : []

  React.useEffect(() => {
    if (!copied) return

    const timer = window.setTimeout(() => setCopied(false), 1_200)

    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(account.wallet.address)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [account.wallet.address])

  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Address
        </span>
        <div className="flex items-start gap-2 rounded-md border bg-background p-3">
          <PrivateValue className="flex-1 font-mono text-sm break-all">
            {account.wallet.address}
          </PrivateValue>
          <Button
            aria-label={copied ? "Address copied" : "Copy address"}
            onClick={handleCopy}
            size="icon-sm"
            title={copied ? "Copied" : "Copy address"}
            type="button"
            variant="ghost"
          >
            {copied ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Balances
        </span>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 rounded-md border bg-background px-3 py-2 text-sm">
          {balanceEntries.length > 0 ? (
            balanceEntries.map(([symbol, amount]) => (
              <React.Fragment key={symbol}>
                <dt className="font-medium text-muted-foreground">{symbol}</dt>
                <dd className="text-right">
                  <PrivateValue>{amount}</PrivateValue>
                </dd>
              </React.Fragment>
            ))
          ) : (
            <>
              <dt className="font-medium text-muted-foreground">Total</dt>
              <dd className="text-right">
                <PrivateValue>{account.wallet.balance}</PrivateValue>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{account.wallet.providerName}</Badge>
        <Badge variant="outline">{networkLabel}</Badge>
        {/* Sits beside the network badge rather than in the top-level
            menu — a shared-machine escape hatch reads better tucked
            next to "which wallet, which network" than as a peer of
            the everyday Disconnect action. */}
        <MenuItem
          className="ms-auto h-auto min-h-0 w-auto gap-1 rounded-full border border-destructive/32 px-2 py-0.5 text-xs text-destructive-foreground data-highlighted:bg-destructive/8 sm:text-xs"
          closeOnClick
          onClick={onForgetDevice}
        >
          <ShieldOffIcon aria-hidden="true" className="size-3" />
          Forget device
        </MenuItem>
      </section>
    </div>
  )
}
