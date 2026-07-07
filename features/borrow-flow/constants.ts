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

export const MOCK_ACCOUNT_ADDRESS = "GABC...7KQ2"
export const MOCK_ACCOUNT_BALANCE = "3,420.24 XLM"
export const MOCK_TRANSACTION_HASH = "3f6d...91b2"
export const COLLATERAL_FACTOR = 0.625

export const DESKTOP_FOOTER_CLASS =
  "flex w-full flex-row items-center justify-between gap-2 border-t bg-muted/72 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]"

export const INITIAL_FLOW_STATE: BorrowFlowState = {
  collateralAmount: "6800",
  loanAmount: "4250",
  transactionStatus: "Draft",
  verificationStatus: "Not started",
}
