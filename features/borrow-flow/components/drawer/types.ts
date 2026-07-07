import type { MarketCardData } from "@/app/_constants/dashboard"

import type {
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
} from "../../types"

export type BorrowFlowStepProps = {
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
