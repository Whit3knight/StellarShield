import type { BorrowFlowState, MarketStep } from "./types"

export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"

export const MARKET_STEPS: MarketStep[] = [
  "detail",
  "collateral",
  "verification",
  "transaction",
]

export const DESKTOP_STACK_PEEK_PX = 23
export const DESKTOP_STACK_SCALE_STEP = 0.05
export const DESKTOP_STACK_RAIL_PX =
  DESKTOP_STACK_PEEK_PX * (MARKET_STEPS.length - 1)

export const ESTIMATED_TRANSACTION_FEE_XLM = 0.00003
export const HEALTH_FACTOR_MIN = 1.25
export const MAX_LOAN_TO_VALUE = 0.625
export const LIQUIDATION_THRESHOLD = 0.8
export const MIN_COLLATERAL_VALUE = 10
export const MIN_LOAN_VALUE = 50

export const DESKTOP_FOOTER_CLASS =
  "flex w-full flex-row items-center justify-between gap-2 border-t bg-muted/72 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]"

export const INITIAL_FLOW_STATE: BorrowFlowState = {
  borrowIntent: null,
  collateralAmount: "3000",
  loanAmount: "220",
  simulationStatus: "Idle",
  transactionPayload: null,
  transactionReceipt: null,
  transactionStatus: "Draft",
  verification: { status: "Not started" },
}
