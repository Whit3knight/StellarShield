"use client"

import { SparklesIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverPopup } from "@/components/ui/popover"

import {
  markOnboardingTourSeen,
  subscribeToOpenTour,
  useOnboardingTourSeen,
} from "../_hooks/use-onboarding-tour"

type TourStep = {
  body: string
  selector: string
  side: "top" | "bottom" | "left" | "right"
  title: string
}

// ponytail: colocated step table; move to a data file if a second surface
// (settings page, help center) needs the same list.
const TOUR_STEPS: TourStep[] = [
  {
    body: "Press ⌘K anytime to search markets, jump between menus, and toggle preferences.",
    selector: '[data-tour="palette"]',
    side: "bottom",
    title: "Command palette",
  },
  {
    body: "Browse all public markets here. Pick one to open the borrow flow.",
    selector: '[data-tour="markets"]',
    side: "top",
    title: "Markets grid",
  },
  {
    body: "Session-wide notifications land under the bell — protocol events and wallet activity.",
    selector: '[data-tour="notifications"]',
    side: "bottom",
    title: "Notifications",
  },
  {
    body: "Wallet identity, balances, Proofs, Activity, and preferences all live behind the wallet menu.",
    selector: '[data-tour="wallet"]',
    side: "bottom",
    title: "Wallet menu",
  },
]

export function OnboardingTour(): React.ReactElement | null {
  const seen = useOnboardingTourSeen()
  const [open, setOpen] = React.useState(false)
  const [currentTip, setCurrentTip] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)

  const step = TOUR_STEPS[currentTip]

  React.useEffect(() => {
    if (seen) return
    if (typeof document === "undefined") return

    const openIfTargetPresent = () => {
      if (document.querySelector(TOUR_STEPS[0].selector)) {
        setCurrentTip(0)
        setOpen(true)
      }
    }

    const raf = window.requestAnimationFrame(openIfTargetPresent)

    return () => window.cancelAnimationFrame(raf)
  }, [seen])

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

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverPopup
        anchor={anchor}
        className="max-w-[280px]"
        side={step.side}
        sideOffset={12}
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <SparklesIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
            />
            <div className="space-y-1">
              <p className="font-medium text-sm">{step.title}</p>
              <p className="text-muted-foreground text-xs">{step.body}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {currentTip + 1}/{TOUR_STEPS.length}
            </span>
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
