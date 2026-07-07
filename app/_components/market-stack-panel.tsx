import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import * as React from "react"

import { getMarketPair, type MarketCardData } from "../_constants/dashboard"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardPanel } from "@/components/ui/card"
import {
  Drawer,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"

import { Sparkline } from "./sparkline"

type MarketStep =
  "detail" | "collateral" | "verification" | "review" | "confirmed"
type VerificationStatus = "Not started" | "Checking" | "Verified"
type TransactionStatus = "Draft" | "Confirmed"
type LoanHealth = "Healthy" | "Attention" | "At risk"

type BorrowFlowState = {
  collateralAmount: string
  loanAmount: string
  transactionStatus: TransactionStatus
  verificationStatus: VerificationStatus
}

type BorrowFlowMetrics = {
  borrowingPower: number
  collateralValue: number
  isLoanValid: boolean
  loanHealth: LoanHealth
  loanValue: number
  utilization: number
}

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"
const MARKET_STEPS: MarketStep[] = [
  "detail",
  "collateral",
  "verification",
  "review",
  "confirmed",
]
const DESKTOP_STACK_PEEK_PX = 23
const DESKTOP_STACK_SCALE_STEP = 0.05
const MOCK_ACCOUNT_ADDRESS = "GABC...7KQ2"
const MOCK_ACCOUNT_BALANCE = "3,420.24 XLM"
const MOCK_TRANSACTION_HASH = "3f6d...91b2"
const COLLATERAL_FACTOR = 0.625
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
})
const DRAWER_PANEL_WIDTH_CLASS = "w-[calc(100%-(--spacing(14)))]"
const DESKTOP_FOOTER_CLASS =
  "flex w-full flex-row items-center justify-between gap-2 border-t bg-muted/72 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]"
const INITIAL_FLOW_STATE: BorrowFlowState = {
  collateralAmount: "6800",
  loanAmount: "4250",
  transactionStatus: "Draft",
  verificationStatus: "Not started",
}

function parseAmount(value: string): number {
  const parsedValue = Number.parseFloat(value.replace(/[^0-9.]/g, ""))

  if (Number.isNaN(parsedValue)) {
    return 0
  }

  return parsedValue
}

function formatUsd(value: number): string {
  return USD_FORMATTER.format(value)
}

function getBorrowFlowMetrics(flow: BorrowFlowState): BorrowFlowMetrics {
  const collateralValue = parseAmount(flow.collateralAmount)
  const loanValue = parseAmount(flow.loanAmount)
  const borrowingPower = collateralValue * COLLATERAL_FACTOR
  const utilization = borrowingPower > 0 ? loanValue / borrowingPower : 0
  const isLoanValid =
    collateralValue > 0 && loanValue > 0 && loanValue <= borrowingPower
  const loanHealth: LoanHealth = !isLoanValid
    ? "At risk"
    : utilization > 0.85
      ? "Attention"
      : "Healthy"

  return {
    borrowingPower,
    collateralValue,
    isLoanValid,
    loanHealth,
    loanValue,
    utilization,
  }
}

function getIsDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  )
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(getIsDesktop)

  React.useEffect(() => {
    const mediaQueryList = window.matchMedia(DESKTOP_MEDIA_QUERY)
    const handleChange = () => {
      setIsDesktop(mediaQueryList.matches)
    }

    handleChange()
    mediaQueryList.addEventListener("change", handleChange)

    return () => {
      mediaQueryList.removeEventListener("change", handleChange)
    }
  }, [])

  return isDesktop
}

function useBorrowFlow(): {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  setFieldValue: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  submitTransaction: () => void
  verifyEligibility: () => void
} {
  const [flow, setFlow] = React.useState<BorrowFlowState>(INITIAL_FLOW_STATE)
  const verificationTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const metrics = React.useMemo(() => getBorrowFlowMetrics(flow), [flow])

  React.useEffect(() => {
    return () => {
      if (verificationTimerRef.current) {
        clearTimeout(verificationTimerRef.current)
      }
    }
  }, [])

  const setFieldValue = React.useCallback(
    (field: "collateralAmount" | "loanAmount", value: string) => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        [field]: value,
        transactionStatus: "Draft",
        verificationStatus: "Not started",
      }))
    },
    []
  )

  const verifyEligibility = React.useCallback(() => {
    if (verificationTimerRef.current) {
      clearTimeout(verificationTimerRef.current)
    }

    setFlow((currentFlow) => ({
      ...currentFlow,
      verificationStatus: "Checking",
    }))

    verificationTimerRef.current = setTimeout(() => {
      setFlow((currentFlow) => ({
        ...currentFlow,
        verificationStatus: "Verified",
      }))
    }, 650)
  }, [])

  const submitTransaction = React.useCallback(() => {
    setFlow((currentFlow) => ({
      ...currentFlow,
      transactionStatus: "Confirmed",
    }))
  }, [])

  return {
    flow,
    metrics,
    setFieldValue,
    submitTransaction,
    verifyEligibility,
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: string
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function MetricTile({
  label,
  value,
}: {
  label: string
  value: string
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-muted/48 p-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}

function MarketDetail({
  market,
}: {
  market: MarketCardData
}): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="p-0">
          <Sparkline
            className="w-full rounded-md text-chart-2"
            label={`${market.symbol} borrow APR trend`}
            points={market.chart}
          />
        </CardPanel>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Supply APY" value={market.supplyApy} />
        <MetricTile label="Borrow APR" value={market.borrowApr} />
        <MetricTile label="Available" value={market.availableFunds} />
        <MetricTile label="Utilization" value={market.utilization} />
      </div>

      <div className="rounded-md border bg-muted/48 p-3 text-sm">
        <div className="font-medium">ZKP eligibility</div>
        <p className="mt-1 text-muted-foreground">
          Borrow eligibility is verified before transaction review without
          exposing private wallet details.
        </p>
      </div>
    </>
  )
}

function BorrowTermsStep({
  flow,
  market,
  metrics,
  onFieldChange,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
}): React.ReactElement {
  return (
    <Form className="flex w-full flex-col gap-4">
      <Field>
        <FieldLabel>Market</FieldLabel>
        <Input defaultValue={getMarketPair(market)} readOnly type="text" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Collateral value</FieldLabel>
          <Input
            inputMode="decimal"
            onChange={(event) => {
              onFieldChange("collateralAmount", event.currentTarget.value)
            }}
            type="text"
            value={flow.collateralAmount}
          />
          <FieldDescription>{MOCK_ACCOUNT_BALANCE} available</FieldDescription>
        </Field>
        <Field invalid={!metrics.isLoanValid}>
          <FieldLabel>Loan amount</FieldLabel>
          <Input
            aria-invalid={!metrics.isLoanValid}
            inputMode="decimal"
            onChange={(event) => {
              onFieldChange("loanAmount", event.currentTarget.value)
            }}
            type="text"
            value={flow.loanAmount}
          />
          <FieldDescription>
            Available to borrow: {formatUsd(metrics.borrowingPower)}
          </FieldDescription>
          {!metrics.isLoanValid ? (
            <FieldError>
              Loan amount exceeds current borrowing power.
            </FieldError>
          ) : null}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="Borrowing power"
          value={formatUsd(metrics.borrowingPower)}
        />
        <MetricTile label="Borrow APR" value={market.borrowApr} />
        <MetricTile label="Loan health" value={metrics.loanHealth} />
        <MetricTile
          label="Utilization"
          value={`${Math.round(metrics.utilization * 100)}%`}
        />
      </div>
    </Form>
  )
}

function VerificationStep({
  flow,
  market,
  metrics,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow label="Account" value={MOCK_ACCOUNT_ADDRESS} />
          <DetailRow label="Balance" value={MOCK_ACCOUNT_BALANCE} />
          <DetailRow label="Market" value={getMarketPair(market)} />
          <DetailRow
            label="Borrowing power"
            value={formatUsd(metrics.borrowingPower)}
          />
          <DetailRow label="Loan amount" value={formatUsd(metrics.loanValue)} />
        </CardPanel>
      </Card>

      <div className="rounded-md border bg-muted/48 p-3 text-sm">
        <div className="font-medium">Private verification</div>
        <p className="mt-1 text-muted-foreground">
          Eligibility is checked before review without exposing sensitive wallet
          details.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MetricTile label="Status" value={flow.verificationStatus} />
          <MetricTile label="Loan health" value={metrics.loanHealth} />
        </div>
      </div>
    </>
  )
}

function ReviewStep({
  flow,
  market,
  metrics,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): React.ReactElement {
  return (
    <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
      <CardPanel className="space-y-1">
        <DetailRow label="Market" value={getMarketPair(market)} />
        <DetailRow label="Account" value={MOCK_ACCOUNT_ADDRESS} />
        <DetailRow
          label="Collateral"
          value={formatUsd(metrics.collateralValue)}
        />
        <DetailRow label="Loan amount" value={formatUsd(metrics.loanValue)} />
        <DetailRow label="Borrow APR" value={market.borrowApr} />
        <DetailRow label="Loan health" value={metrics.loanHealth} />
        <DetailRow label="Verification" value={flow.verificationStatus} />
        <DetailRow label="Transaction state" value={flow.transactionStatus} />
        <DetailRow label="Estimated fee" value="0.00003 XLM" />
      </CardPanel>
    </Card>
  )
}

function PositionSummaryStep({
  flow,
  market,
  metrics,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
}): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow label="Position" value={getMarketPair(market)} />
          <DetailRow
            label="Collateral supplied"
            value={formatUsd(metrics.collateralValue)}
          />
          <DetailRow
            label="Borrowed amount"
            value={formatUsd(metrics.loanValue)}
          />
          <DetailRow label="Borrow APR" value={market.borrowApr} />
          <DetailRow label="Loan health" value={metrics.loanHealth} />
          <DetailRow label="Transaction" value={flow.transactionStatus} />
          <DetailRow label="Receipt" value={MOCK_TRANSACTION_HASH} />
        </CardPanel>
      </Card>

      <div className="rounded-md border bg-muted/48 p-3 text-sm">
        <div className="font-medium">Position is active</div>
        <p className="mt-1 text-muted-foreground">
          The borrow receipt is ready for Activity. You can add collateral or
          repay from the position view next.
        </p>
      </div>
    </>
  )
}

function getStepCopy(
  market: MarketCardData,
  step: MarketStep
): { description: string; title: string } {
  if (step === "collateral") {
    return {
      description: "Add collateral and choose the loan amount for this market.",
      title: "Add collateral",
    }
  }

  if (step === "verification") {
    return {
      description: "Confirm eligibility without exposing wallet details.",
      title: "Private verification",
    }
  }

  if (step === "review") {
    return {
      description:
        "Confirm the borrow request before submitting it to Stellar.",
      title: "Review transaction",
    }
  }

  if (step === "confirmed") {
    return {
      description: "Your borrow position has been recorded.",
      title: "Position summary",
    }
  }

  return {
    description:
      "Public market details are visible before connecting a wallet.",
    title: getMarketPair(market),
  }
}

function DrawerStepBody({
  flow,
  market,
  metrics,
  onFieldChange,
  step,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  step: MarketStep
}): React.ReactElement {
  if (step === "collateral") {
    return (
      <BorrowTermsStep
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
      />
    )
  }

  if (step === "verification") {
    return <VerificationStep flow={flow} market={market} metrics={metrics} />
  }

  if (step === "review") {
    return <ReviewStep flow={flow} market={market} metrics={metrics} />
  }

  if (step === "confirmed") {
    return <PositionSummaryStep flow={flow} market={market} metrics={metrics} />
  }

  return <MarketDetail market={market} />
}

function getStepIndex(step: MarketStep): number {
  return MARKET_STEPS.indexOf(step)
}

function MarketDrawerFooter({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <DrawerFooter className="w-full flex-row items-center justify-between sm:justify-between">
      {children}
    </DrawerFooter>
  )
}

function DesktopMarketFooter({
  flow,
  metrics,
  onClose,
  onSubmit,
  onStepChange,
  onVerify,
  step,
}: {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  onClose: () => void
  onSubmit: () => void
  onStepChange: (step: MarketStep) => void
  onVerify: () => void
  step: MarketStep
}): React.ReactElement {
  return (
    <div className={DESKTOP_FOOTER_CLASS}>
      <MarketStepFooterActions
        flow={flow}
        metrics={metrics}
        onClose={onClose}
        onStepChange={onStepChange}
        onSubmit={onSubmit}
        onVerify={onVerify}
        step={step}
      />
    </div>
  )
}

function MarketStepFooterActions({
  flow,
  metrics,
  onClose,
  onStepChange,
  onSubmit,
  onVerify,
  step,
}: {
  flow: BorrowFlowState
  metrics: BorrowFlowMetrics
  onClose: () => void
  onStepChange: (step: MarketStep) => void
  onSubmit: () => void
  onVerify: () => void
  step: MarketStep
}): React.ReactElement {
  if (step === "confirmed") {
    return (
      <>
        <Button onClick={onClose} type="button" variant="ghost">
          Close
        </Button>
        <Button onClick={onClose} type="button">
          Done
        </Button>
      </>
    )
  }

  if (step === "review") {
    return (
      <>
        <Button
          onClick={() => {
            onStepChange("verification")
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button
          onClick={() => {
            onSubmit()
            onStepChange("confirmed")
          }}
          type="button"
        >
          Submit transaction
        </Button>
      </>
    )
  }

  if (step === "verification") {
    const isChecking = flow.verificationStatus === "Checking"
    const isVerified = flow.verificationStatus === "Verified"

    return (
      <>
        <Button
          onClick={() => {
            onStepChange("collateral")
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button
          disabled={isChecking || !metrics.isLoanValid}
          loading={isChecking}
          onClick={() => {
            if (isVerified) {
              onStepChange("review")
              return
            }

            onVerify()
          }}
          type="button"
        >
          {isVerified ? "Continue" : "Verify eligibility"}
          {!isVerified ? null : <ArrowRightIcon aria-hidden="true" />}
        </Button>
      </>
    )
  }

  if (step === "collateral") {
    return (
      <>
        <Button
          onClick={() => {
            onStepChange("detail")
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button
          disabled={!metrics.isLoanValid}
          onClick={() => {
            onStepChange("verification")
          }}
          type="button"
        >
          Continue
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </>
    )
  }

  return (
    <>
      <Button onClick={onClose} type="button" variant="ghost">
        Close
      </Button>
      <Button
        onClick={() => {
          onStepChange("collateral")
        }}
        type="button"
      >
        Start borrow
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </>
  )
}

function DesktopMarketStepPanel({
  activeStep,
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
  onStepChange,
  onVerify,
  step,
}: {
  activeStep: MarketStep
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onClose: () => void
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  onSubmit: () => void
  onStepChange: (step: MarketStep) => void
  onVerify: () => void
  step: MarketStep
}): React.ReactElement {
  const activeIndex = getStepIndex(activeStep)
  const stepIndex = getStepIndex(step)
  const depth = activeIndex - stepIndex
  const isActive = depth === 0
  const isBehind = depth > 0
  const stepCopy = getStepCopy(market, step)
  const scale = Math.max(0.86, 1 - depth * DESKTOP_STACK_SCALE_STEP)
  const transform = isBehind
    ? `translateX(-${depth * DESKTOP_STACK_PEEK_PX}px) scale(${scale})`
    : depth < 0
      ? "translateX(calc(100% + 1px))"
      : "translateX(0) scale(1)"

  return (
    <section
      aria-hidden={!isActive}
      className={`${DRAWER_PANEL_WIDTH_CLASS} absolute inset-y-0 right-0 flex max-w-none min-w-0 origin-left flex-col overflow-hidden rounded-s-2xl border-s bg-popover text-popover-foreground shadow-lg/5 transition-[transform,opacity,box-shadow,background-color] duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-s-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]`}
      inert={isActive ? undefined : true}
      style={{
        opacity: depth < -1 ? 0 : 1,
        transform,
        zIndex: 20 + stepIndex,
      }}
    >
      <div className="flex flex-col gap-2 p-6 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl leading-none font-semibold">
              {stepCopy.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {stepCopy.description}
            </p>
          </div>
          <Badge variant="outline">{market.risk}</Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-1">
        <div className="space-y-5">
          <DrawerStepBody
            flow={flow}
            market={market}
            metrics={metrics}
            onFieldChange={onFieldChange}
            step={step}
          />
        </div>
      </div>

      <DesktopMarketFooter
        flow={flow}
        metrics={metrics}
        onClose={onClose}
        onSubmit={onSubmit}
        onStepChange={onStepChange}
        onVerify={onVerify}
        step={step}
      />
    </section>
  )
}

function MarketDrawerPopup(props: {
  children: React.ReactNode
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  step: MarketStep
}): React.ReactElement {
  const { children, flow, market, metrics, onFieldChange, step } = props
  const stepCopy = getStepCopy(market, step)

  return (
    <DrawerPopup showBar>
      <DrawerHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <DrawerTitle>{stepCopy.title}</DrawerTitle>
            <DrawerDescription className="mt-2">
              {stepCopy.description}
            </DrawerDescription>
          </div>
          <Badge variant="outline">{market.risk}</Badge>
        </div>
      </DrawerHeader>

      <DrawerPanel className="space-y-5" scrollFade>
        <DrawerStepBody
          flow={flow}
          market={market}
          metrics={metrics}
          onFieldChange={onFieldChange}
          step={step}
        />
      </DrawerPanel>

      {children}
    </DrawerPopup>
  )
}

function MobileDrawerBackButton(): React.ReactElement {
  return (
    <DrawerClose render={<Button type="button" variant="ghost" />}>
      <ArrowLeftIcon aria-hidden="true" />
      Back
    </DrawerClose>
  )
}

function MobileConfirmedDrawer({
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onClose: () => void
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  onSubmit: () => void
}): React.ReactElement {
  return (
    <Drawer>
      <DrawerTrigger onClick={onSubmit} render={<Button type="button" />}>
        Submit transaction
      </DrawerTrigger>
      <MarketDrawerPopup
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        step="confirmed"
      >
        <MarketDrawerFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Close
          </Button>
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function MobileReviewDrawer({
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onClose: () => void
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  onSubmit: () => void
}): React.ReactElement {
  return (
    <Drawer>
      <DrawerTrigger render={<Button type="button" />}>
        Continue
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        step="review"
      >
        <MarketDrawerFooter>
          <MobileDrawerBackButton />
          <MobileConfirmedDrawer
            flow={flow}
            market={market}
            metrics={metrics}
            onClose={onClose}
            onFieldChange={onFieldChange}
            onSubmit={onSubmit}
          />
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function MobileVerificationDrawer({
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
  onVerify,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onClose: () => void
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  onSubmit: () => void
  onVerify: () => void
}): React.ReactElement {
  const isChecking = flow.verificationStatus === "Checking"
  const isVerified = flow.verificationStatus === "Verified"

  return (
    <Drawer>
      <DrawerTrigger
        render={<Button disabled={!metrics.isLoanValid} type="button" />}
      >
        Continue
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        step="verification"
      >
        <MarketDrawerFooter>
          <MobileDrawerBackButton />
          {isVerified ? (
            <MobileReviewDrawer
              flow={flow}
              market={market}
              metrics={metrics}
              onClose={onClose}
              onFieldChange={onFieldChange}
              onSubmit={onSubmit}
            />
          ) : (
            <Button
              disabled={isChecking || !metrics.isLoanValid}
              loading={isChecking}
              onClick={onVerify}
              type="button"
            >
              Verify eligibility
            </Button>
          )}
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function MobileCollateralDrawer({
  flow,
  market,
  metrics,
  onClose,
  onFieldChange,
  onSubmit,
  onVerify,
}: {
  flow: BorrowFlowState
  market: MarketCardData
  metrics: BorrowFlowMetrics
  onClose: () => void
  onFieldChange: (
    field: "collateralAmount" | "loanAmount",
    value: string
  ) => void
  onSubmit: () => void
  onVerify: () => void
}): React.ReactElement {
  return (
    <Drawer>
      <DrawerTrigger render={<Button type="button" />}>
        Start borrow
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={onFieldChange}
        step="collateral"
      >
        <MarketDrawerFooter>
          <MobileDrawerBackButton />
          <MobileVerificationDrawer
            flow={flow}
            market={market}
            metrics={metrics}
            onClose={onClose}
            onFieldChange={onFieldChange}
            onSubmit={onSubmit}
            onVerify={onVerify}
          />
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function MobileMarketDrawer({
  market,
  onClose,
}: {
  market: MarketCardData
  onClose: () => void
}): React.ReactElement {
  const { flow, metrics, setFieldValue, submitTransaction, verifyEligibility } =
    useBorrowFlow()

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <MarketDrawerPopup
        flow={flow}
        market={market}
        metrics={metrics}
        onFieldChange={setFieldValue}
        step="detail"
      >
        <MarketDrawerFooter>
          <DrawerClose render={<Button type="button" variant="ghost" />}>
            Close
          </DrawerClose>
          <MobileCollateralDrawer
            flow={flow}
            market={market}
            metrics={metrics}
            onClose={onClose}
            onFieldChange={setFieldValue}
            onSubmit={submitTransaction}
            onVerify={verifyEligibility}
          />
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function DesktopMarketDrawer({
  market,
  onClose,
}: {
  market: MarketCardData
  onClose: () => void
}): React.ReactElement {
  const [activeStep, setActiveStep] = React.useState<MarketStep>("detail")
  const { flow, metrics, setFieldValue, submitTransaction, verifyEligibility } =
    useBorrowFlow()

  return (
    <aside className="ml-4 min-w-0 lg:sticky lg:top-0 lg:self-start">
      <div className="relative isolate overflow-hidden rounded-lg lg:h-[calc(100svh-4rem)]">
        {MARKET_STEPS.map((step) => (
          <DesktopMarketStepPanel
            activeStep={activeStep}
            flow={flow}
            key={step}
            market={market}
            metrics={metrics}
            onClose={onClose}
            onFieldChange={setFieldValue}
            onSubmit={submitTransaction}
            onStepChange={setActiveStep}
            onVerify={verifyEligibility}
            step={step}
          />
        ))}
      </div>
    </aside>
  )
}

export function MarketStackPanel({
  market,
  onClose,
}: {
  market: MarketCardData
  onClose: () => void
}): React.ReactElement {
  const isDesktop = useIsDesktop()

  if (!isDesktop) {
    return <MobileMarketDrawer market={market} onClose={onClose} />
  }

  return <DesktopMarketDrawer market={market} onClose={onClose} />
}
