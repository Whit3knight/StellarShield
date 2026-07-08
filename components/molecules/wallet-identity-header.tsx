"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import * as React from "react"

import { PrivateValue } from "@/components/atoms/private-value"
import { Button } from "@/components/ui/button"

import type { ConnectedAccount } from "@/app/_constants/account"

type WalletIdentityHeaderProps = {
  account: ConnectedAccount
}

export function WalletIdentityHeader({
  account,
}: WalletIdentityHeaderProps): React.ReactElement {
  const [copiedAddress, setCopiedAddress] = React.useState(false)

  React.useEffect(() => {
    if (!copiedAddress) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCopiedAddress(false)
    }, 1200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [copiedAddress])

  const handleCopyAddress = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      try {
        await navigator.clipboard.writeText(account.wallet.address)
        setCopiedAddress(true)
      } catch {
        setCopiedAddress(false)
      }
    },
    [account.wallet.address]
  )

  return (
    <div className="flex items-start justify-between gap-3 px-2 py-2 text-left">
      <span className="flex min-w-0 flex-col">
        <PrivateValue className="truncate text-sm font-medium text-foreground">
          {account.wallet.shortAddress}
        </PrivateValue>
        <PrivateValue className="truncate text-xs font-normal text-muted-foreground">
          {account.wallet.balance}
        </PrivateValue>
      </span>
      <Button
        aria-label={
          copiedAddress ? "Wallet address copied" : "Copy wallet address"
        }
        className="-me-1 mt-0.5"
        onClick={handleCopyAddress}
        size="icon-sm"
        title={copiedAddress ? "Copied" : "Copy address"}
        variant="ghost"
      >
        {copiedAddress ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}
