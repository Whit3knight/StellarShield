import type * as React from "react"

import type { ConnectedAccount } from "@/app/_constants/account"
import { DetailRow } from "@/components/atoms/detail-row"
import { Card, CardPanel } from "@/components/ui/card"
import { getMarketPair, type MarketCardData } from "@/features/markets"

import type { BorrowFlowMetrics, BorrowFlowState } from "../../types"
import { formatAssetAmount, formatUsd } from "../../utils"

type VerificationStepProps = {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}

export function VerificationStep({
  account,
  flow,
  market,
  metrics,
}: VerificationStepProps): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow
            label="Account"
            privateValue
            value={account?.wallet.shortAddress ?? "Connect wallet"}
          />
          <DetailRow
            label="Available collateral"
            privateValue
            value={
              account
                ? formatAssetAmount(
                    metrics.collateralWalletBalance,
                    market.collateral
                  )
                : "Connect wallet"
            }
          />
          <DetailRow label="Market" value={getMarketPair(market)} />
          <DetailRow
            label="Collateral"
            value={formatAssetAmount(
              metrics.collateralAmount,
              market.collateral
            )}
          />
          <DetailRow
            label="Borrowing power"
            value={formatUsd(metrics.borrowingPower)}
          />
          <DetailRow
            label="Loan amount"
            value={formatAssetAmount(metrics.loanAmount, market.symbol)}
          />
          <DetailRow
            label="Private verification"
            value={flow.verificationStatus}
          />
          <DetailRow label="Simulation" value={flow.simulationStatus} />
          <DetailRow
            label="Proof claim"
            value={flow.proof?.claim ?? "Not generated"}
          />
          <DetailRow
            label="Borrow intent"
            privateValue
            value={flow.borrowIntent?.id ?? "Prepared after verification"}
          />
          <DetailRow
            label="Expires"
            value={
              flow.proof
                ? new Intl.DateTimeFormat("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(flow.proof.expiresAt))
                : "After verification"
            }
          />
          <DetailRow label="Loan health" value={metrics.loanHealth} />
          <DetailRow label="Wallet details" value="Not exposed" />
        </CardPanel>
      </Card>
    </>
  )
}
