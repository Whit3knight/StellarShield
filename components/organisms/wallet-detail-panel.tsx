"use client"

import { ExternalLinkIcon, LogOutIcon } from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { WalletIdentityHeader } from "@/components/molecules/wallet-identity-header"
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
  const explorerUrl = getStellarExpertAccountUrl(account.wallet.address)
  const networkLabel = getConfiguredNetworkLabel()

  const balanceEntries = account.wallet.balances
    ? Object.entries(account.wallet.balances)
    : []

  const handleDisconnect = React.useCallback(() => {
    onDisconnect()
    onClose()
  }, [onClose, onDisconnect])

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="rounded-md border bg-muted/32 p-1">
        <WalletIdentityHeader account={account} />
      </div>

      <section className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Address
        </span>
        <div className="rounded-md border bg-background p-3">
          <PrivateValue className="font-mono text-sm break-all">
            {account.wallet.address}
          </PrivateValue>
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
