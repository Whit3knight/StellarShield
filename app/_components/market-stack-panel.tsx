import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import * as React from "react"

import {
  borrowOverview,
  getMarketPair,
  type MarketCardData,
} from "../_constants/dashboard"

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
import { Field, FieldLabel } from "@/components/ui/field"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"

import { Sparkline } from "./sparkline"

type MarketStep = "detail" | "borrow" | "review"

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"
const MARKET_STEPS: MarketStep[] = ["detail", "borrow", "review"]
const DESKTOP_STACK_PEEK_PX = 23
const DESKTOP_STACK_SCALE_STEP = 0.05

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

function BorrowStep({
  market,
}: {
  market: MarketCardData
}): React.ReactElement {
  return (
    <Form className="flex w-full flex-col gap-4">
      <Field>
        <FieldLabel>Market</FieldLabel>
        <Input defaultValue={getMarketPair(market)} readOnly type="text" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Collateral</FieldLabel>
          <Input defaultValue={borrowOverview.collateral} type="text" />
        </Field>
        <Field>
          <FieldLabel>Loan amount</FieldLabel>
          <Input defaultValue={borrowOverview.availableToBorrow} type="text" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Available" value={market.availableFunds} />
        <MetricTile label="Borrow APR" value={market.borrowApr} />
        <MetricTile label="Loan status" value={borrowOverview.loanStatus} />
        <MetricTile label="Verification" value={borrowOverview.verification} />
      </div>
    </Form>
  )
}

function ReviewStep({
  market,
}: {
  market: MarketCardData
}): React.ReactElement {
  return (
    <>
      <Card className="rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]">
        <CardPanel className="space-y-1">
          <DetailRow label="Market" value={getMarketPair(market)} />
          <DetailRow label="Collateral" value={borrowOverview.collateral} />
          <DetailRow
            label="Loan amount"
            value={borrowOverview.availableToBorrow}
          />
          <DetailRow label="Borrow APR" value={market.borrowApr} />
          <DetailRow label="Estimated fee" value="0.00003 XLM" />
        </CardPanel>
      </Card>

    </>
  )
}

function getStepCopy(
  market: MarketCardData,
  step: MarketStep
): { description: string; title: string } {
  if (step === "borrow") {
    return {
      description: `Enter terms for the ${getMarketPair(market)} market.`,
      title: `Borrow ${market.symbol}`,
    }
  }

  if (step === "review") {
    return {
      description: "Confirm the borrow request before submitting it to Stellar.",
      title: "Review transaction",
    }
  }

  return {
    description: "Public market details are visible before connecting a wallet.",
    title: getMarketPair(market),
  }
}

function DrawerStepBody({
  market,
  step,
}: {
  market: MarketCardData
  step: MarketStep
}): React.ReactElement {
  if (step === "borrow") {
    return <BorrowStep market={market} />
  }

  if (step === "review") {
    return <ReviewStep market={market} />
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
  onClose,
  onStepChange,
  step,
}: {
  onClose: () => void
  onStepChange: (step: MarketStep) => void
  step: MarketStep
}): React.ReactElement {
  if (step === "review") {
    return (
      <div className="flex w-full flex-row items-center justify-between gap-2 border-t bg-muted/72 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]">
        <Button
          onClick={() => {
            onStepChange("borrow")
          }}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button type="button">Submit transaction</Button>
      </div>
    )
  }

  if (step === "borrow") {
    return (
      <div className="flex w-full flex-row items-center justify-between gap-2 border-t bg-muted/72 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]">
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
          onClick={() => {
            onStepChange("review")
          }}
          type="button"
          variant="outline"
        >
          Review transaction
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-row items-center justify-between gap-2 border-t bg-muted/72 px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]">
      <Button onClick={onClose} type="button" variant="ghost">
        Close
      </Button>
      <Button
        onClick={() => {
          onStepChange("borrow")
        }}
        type="button"
      >
        Start borrow
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    </div>
  )
}

function DesktopMarketStepPanel({
  activeStep,
  market,
  onClose,
  onStepChange,
  step,
}: {
  activeStep: MarketStep
  market: MarketCardData
  onClose: () => void
  onStepChange: (step: MarketStep) => void
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
      className="absolute inset-y-0 right-0 flex w-[calc(100%-(--spacing(14)))] min-w-0 max-w-none origin-left flex-col overflow-hidden rounded-s-2xl border-s bg-popover text-popover-foreground shadow-lg/5 outline-none transition-[transform,opacity,box-shadow,background-color] duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform before:pointer-events-none before:absolute before:inset-0 before:rounded-s-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
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
            <h2 className="font-heading font-semibold text-xl leading-none">
              {stepCopy.title}
            </h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {stepCopy.description}
            </p>
          </div>
          <Badge variant="outline">{market.risk}</Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-1">
        <div className="space-y-5">
          <DrawerStepBody market={market} step={step} />
        </div>
      </div>

      <DesktopMarketFooter
        onClose={onClose}
        onStepChange={onStepChange}
        step={step}
      />
    </section>
  )
}

function MarketDrawerPopup(
  props: {
    children: React.ReactNode
    market: MarketCardData
    step: MarketStep
    visibleStep?: MarketStep
  }
): React.ReactElement {
  const { children, market, step, visibleStep } = props
  const renderedStep = visibleStep ?? step
  const stepCopy = getStepCopy(market, renderedStep)

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
        <DrawerStepBody market={market} step={renderedStep} />
      </DrawerPanel>

      {children}
    </DrawerPopup>
  )
}

function ReviewDrawer(
  { market }: { market: MarketCardData }
): React.ReactElement {
  const [returningToBorrow, setReturningToBorrow] = React.useState(false)

  return (
    <Drawer
      onOpenChange={(open) => {
        if (open) {
          setReturningToBorrow(false)
        }
      }}
      position="bottom"
    >
      <DrawerTrigger render={<Button variant="outline" />}>
        Review transaction
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup
        market={market}
        step="review"
        visibleStep={returningToBorrow ? "borrow" : undefined}
      >
        <MarketDrawerFooter>
          <DrawerClose
            onClick={() => {
              setReturningToBorrow(true)
            }}
            render={<Button variant="ghost" />}
          >
            <ArrowLeftIcon aria-hidden="true" />
            Back
          </DrawerClose>
          <Button>Submit transaction</Button>
        </MarketDrawerFooter>
      </MarketDrawerPopup>
    </Drawer>
  )
}

function BorrowDrawer(
  { market }: { market: MarketCardData }
): React.ReactElement {
  const [returningToDetail, setReturningToDetail] = React.useState(false)

  return (
    <Drawer
      onOpenChange={(open) => {
        if (open) {
          setReturningToDetail(false)
        }
      }}
      position="bottom"
    >
      <DrawerTrigger render={<Button />}>
        Start borrow
        <ArrowRightIcon aria-hidden="true" />
      </DrawerTrigger>
      <MarketDrawerPopup
        market={market}
        step="borrow"
        visibleStep={returningToDetail ? "detail" : undefined}
      >
        <MarketDrawerFooter>
          <DrawerClose
            onClick={() => {
              setReturningToDetail(true)
            }}
            render={<Button variant="ghost" />}
          >
            <ArrowLeftIcon aria-hidden="true" />
            Back
          </DrawerClose>
          <ReviewDrawer market={market} />
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
  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <MarketDrawerPopup market={market} step="detail">
        <MarketDrawerFooter>
          <DrawerClose render={<Button variant="ghost" />}>Close</DrawerClose>
          <BorrowDrawer market={market} />
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

  return (
    <aside className="min-w-0 ml-4 lg:sticky lg:top-0 lg:self-start">
      <div className="relative isolate overflow-hidden rounded-lg lg:h-[calc(100svh-4rem)]">
        {MARKET_STEPS.map((step) => (
          <DesktopMarketStepPanel
            activeStep={activeStep}
            key={step}
            market={market}
            onClose={onClose}
            onStepChange={setActiveStep}
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
