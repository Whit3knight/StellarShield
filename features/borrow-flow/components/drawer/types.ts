import type { ConnectedAccount } from "@/app/_constants/account"
import type { MarketCardData } from "@/features/markets"

import type {
  BorrowActivity,
  BorrowField,
  BorrowFlowMetrics,
  BorrowFlowState,
  UserPosition,
} from "../../types"

export type BorrowFlowStepProps = {
  account: ConnectedAccount | null
  activity: BorrowActivity[]
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (field: BorrowField, value: string) => void
  onRefreshTransaction: () => void
  position: UserPosition | null
}

export type BorrowFlowDrawerProps = BorrowFlowStepProps & {
  onClose: () => void
  onSubmit: () => void
  onVerify: () => void
}
