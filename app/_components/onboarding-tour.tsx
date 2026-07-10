"use client"

import {
  LandmarkIcon,
  type LucideIcon,
  SearchIcon,
  WalletCardsIcon,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverPopup,
  PopoverPrimitive,
} from "@/components/ui/popover"
import { useWalletConnection } from "@/features/wallet/use-wallet-connection"
import { cn } from "@/lib/utils"

import {
  markOnboardingTourSeen,
  subscribeToOpenTour,
  useOnboardingTourSeen,
} from "../_hooks/use-onboarding-tour"

type TourStep = {
  body: string
  icon: LucideIcon
  selector: string
  side: "top" | "bottom" | "left" | "right"
  title: string
}

// ponytail: colocated step table; move to a data file if a second surface
// (settings page, help center) needs the same list.
const TOUR_STEPS: TourStep[] = [
  {
    body: "Press ⌘K to search markets, jump between drawers, and toggle preferences. Every action is one keystroke away.",
    icon: SearchIcon,
    selector: '[data-tour="palette"]',
    side: "bottom",
    title: "Command palette",
  },
  {
    body: "Public Stellar markets. Pick one to open the borrow flow with a live quote and a ZK eligibility proof.",
    icon: LandmarkIcon,
    selector: '[data-tour="markets"]',
    side: "top",
    title: "Markets grid",
  },
  {
    body: "Wallet identity, Proofs history, and the session Activity feed all live here — plus a shortcut to Stellar Expert.",
    icon: WalletCardsIcon,
    selector: '[data-tour="wallet"]',
    side: "bottom",
    title: "Wallet menu",
  },
]

export function OnboardingTour(): React.ReactElement | null {
  const seen = useOnboardingTourSeen()
  const { account } = useWalletConnection()
  const [open, setOpen] = React.useState(false)
  const [currentTip, setCurrentTip] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  // ponytail: init lazily to the FIRST observed address so cold-load
  // rehydration doesn't count as a null->address transition. Drop the
  // lazy init if returning users should also see the tour.
  const previousAddressRef = React.useRef<string | null | undefined>(undefined)

  const step = TOUR_STEPS[currentTip]

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const address = account?.wallet.address ?? null

    if (previousAddressRef.current === undefined) {
      previousAddressRef.current = address
      return
    }

    const previous = previousAddressRef.current
    previousAddressRef.current = address

    if (previous !== null || address === null || seen) return

    const raf = window.requestAnimationFrame(() => {
      setCurrentTip(0)
      setOpen(true)
    })

    return () => window.cancelAnimationFrame(raf)
  }, [account, seen])

  React.useEffect(() => {
    return subscribeToOpenTour(() => {
      setCurrentTip(0)
      setOpen(true)
    })
  }, [])

  React.useLayoutEffect(() => {
    if (!open) return

    const measure = () => {
      const target = document.querySelector(step.selector)
      setRect(target ? target.getBoundingClientRect() : null)
    }

    measure()

    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, { capture: true, passive: true })

    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, { capture: true })
    }
  }, [open, step.selector])

  const anchor = React.useMemo(() => {
    if (!rect) return null

    return {
      getBoundingClientRect: () => rect,
    }
  }, [rect])

  const spotlightClipPath = React.useMemo(() => {
    if (!rect || typeof window === "undefined") return undefined

    const PAD = 12
    const RADIUS = 8
    const W = window.innerWidth
    const H = window.innerHeight
    const x1 = Math.max(0, rect.x - PAD)
    const y1 = Math.max(0, rect.y - PAD)
    const x2 = Math.min(W, rect.right + PAD)
    const y2 = Math.min(H, rect.bottom + PAD)
    const r = Math.max(0, Math.min(RADIUS, (x2 - x1) / 2, (y2 - y1) / 2))

    const hole =
      `M${x1 + r},${y1} H${x2 - r} A${r},${r} 0 0 1 ${x2},${y1 + r} ` +
      `V${y2 - r} A${r},${r} 0 0 1 ${x2 - r},${y2} H${x1 + r} ` +
      `A${r},${r} 0 0 1 ${x1},${y2 - r} V${y1 + r} A${r},${r} 0 0 1 ${x1 + r},${y1} Z`

    return `path(evenodd, "M0,0 H${W} V${H} H0 Z ${hole}")`
  }, [rect])

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) markOnboardingTourSeen()
  }, [])

  const handleNext = React.useCallback(() => {
    setCurrentTip((current) =>
      current === TOUR_STEPS.length - 1 ? 0 : current + 1
    )
  }, [])

  const handleFinish = React.useCallback(() => {
    setOpen(false)
    markOnboardingTourSeen()
  }, [])

  if (!open || !anchor) return null

  const isLast = currentTip === TOUR_STEPS.length - 1
  const StepIcon = step.icon

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverPrimitive.Portal>
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[55] bg-background/60 backdrop-blur transition-opacity"
          data-slot="onboarding-tour-backdrop"
          onClick={handleFinish}
          style={{
            clipPath: spotlightClipPath,
            WebkitClipPath: spotlightClipPath,
          }}
        />
      </PopoverPrimitive.Portal>
      <PopoverPopup
        anchor={anchor}
        className="max-w-sm"
        positionerClassName="z-[60]"
        side={step.side}
        sideOffset={12}
      >
        <div className="relative space-y-4">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/32 text-primary">
              <StepIcon aria-hidden="true" className="size-3.5" />
            </span>
            <div className="space-y-1">
              <p className="font-medium text-sm leading-tight">{step.title}</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {step.body}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {TOUR_STEPS.map((_, index) => (
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    index === currentTip ? "bg-primary" : "bg-muted"
                  )}
                  key={index}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleFinish}
                size="sm"
                type="button"
                variant="ghost"
              >
                Skip
              </Button>
              <Button
                onClick={isLast ? handleFinish : handleNext}
                size="sm"
                type="button"
              >
                {isLast ? "Finish" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  )
}
