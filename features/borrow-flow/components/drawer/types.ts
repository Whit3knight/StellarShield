import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import type {
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
} from "../../types"

export type BorrowFlowStepProps = {
  account: ConnectedAccount | null
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (field: BorrowField, value: string) => void
  onRefreshTransaction: () => void
}

export type BorrowFlowDrawerProps = BorrowFlowStepProps & {
  onClose: () => void
  onSubmit: () => void
  onVerify: () => void
}
