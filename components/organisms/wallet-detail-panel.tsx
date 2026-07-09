"use client"

import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LogOutIcon,
} from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ConnectedAccount } from "@/app/_constants/account"
import {
  getConfiguredNetworkLabel,
  getStellarExpertAccountUrl,
} from "@/features/wallet/network"

type WalletDetailPanelProps = {
  account: ConnectedAccount
  onClose: () => void
  onDisconnect: () => void
}

export function WalletDetailPanel({
  account,
  onClose,
  onDisconnect,
}: WalletDetailPanelProps): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  const explorerUrl = getStellarExpertAccountUrl(account.wallet.address)
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

  const handleDisconnect = React.useCallback(() => {
    onDisconnect()
    onClose()
  }, [onClose, onDisconnect])

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
        <Button
          className="ms-auto"
          render={
            <a href={explorerUrl} rel="noreferrer" target="_blank">
              <ExternalLinkIcon aria-hidden="true" />
              Stellar Expert
            </a>
          }
          size="sm"
          variant="ghost"
        />
      </section>

      <div className="flex justify-end border-t pt-3">
        <Button
          onClick={handleDisconnect}
          type="button"
          variant="destructive"
        >
          <LogOutIcon aria-hidden="true" />
          Disconnect
        </Button>
      </div>
    </div>
  )
}
