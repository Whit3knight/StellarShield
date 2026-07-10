"use client"

import {
  ActivityIcon,
  ArrowUpRightIcon,
  BellIcon,
  EyeIcon,
  EyeOffIcon,
  LandmarkIcon,
  LogOutIcon,
  MoonIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  WalletCardsIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import * as React from "react"

import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@/components/ui/command"
import {
  getMarketPair,
  getMarketSearchValue,
  marketCards,
  type MarketCardData,
} from "@/features/markets"
import { useWalletConnection } from "@/features/wallet/use-wallet-connection"
import { setPrivacyMode, usePrivacyMode } from "@/hooks/use-privacy-mode"

import { useMarketSelection } from "../_hooks/use-market-selection"
import { useNavMenus } from "../_hooks/use-nav-menus"
import { resetOnboardingTour } from "../_hooks/use-onboarding-tour"

type CommandActionItem = {
  hint?: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  onSelect: () => void
  value: string
}

type CommandActionGroup = {
  items: CommandActionItem[]
  key: string
  label: string
}

export function CommandSearch(): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const { selectMarket } = useMarketSelection()
  const {
    activityDrawer,
    notifications,
    proofsDrawer,
    walletMenu,
  } = useNavMenus()
  const { account, disconnect } = useWalletConnection()
  const { resolvedTheme, setTheme } = useTheme()
  const isPrivacyMode = usePrivacyMode()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((currentOpen) => !currentOpen)
      }
    }

    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  const groups = React.useMemo<CommandActionGroup[]>(() => {
    const marketItems = marketCards.map<CommandActionItem>((market) => ({
      icon: LandmarkIcon,
      label: getMarketPair(market),
      onSelect: () => {
        selectMarket(market)
        setOpen(false)
      },
      value: getMarketSearchValue(market),
    }))

    const isDark = resolvedTheme === "dark"
    const preferenceItems: CommandActionItem[] = [
      {
        hint: isDark ? "Currently dark" : "Currently light",
        icon: isDark ? SunIcon : MoonIcon,
        label: isDark ? "Switch to light theme" : "Switch to dark theme",
        onSelect: () => {
          setTheme(isDark ? "light" : "dark")
          setOpen(false)
        },
        value: `toggle theme ${isDark ? "light" : "dark"}`,
      },
      {
        hint: isPrivacyMode ? "Currently on" : "Currently off",
        icon: isPrivacyMode ? EyeIcon : EyeOffIcon,
        label: isPrivacyMode ? "Turn off privacy mode" : "Turn on privacy mode",
        onSelect: () => {
          setPrivacyMode(!isPrivacyMode)
          setOpen(false)
        },
        value: "toggle privacy mode",
      },
    ]

    const navigationItems: CommandActionItem[] = [
      {
        icon: ArrowUpRightIcon,
        label: "Go to markets",
        onSelect: () => {
          if (typeof window !== "undefined") {
            document
              .getElementById("markets")
              ?.scrollIntoView({ behavior: "smooth" })
          }
          setOpen(false)
        },
        value: "go to markets",
      },
      {
        icon: ActivityIcon,
        label: "Open activity",
        onSelect: () => {
          activityDrawer.setOpen(true)
          setOpen(false)
        },
        value: "open activity",
      },
      {
        icon: ShieldCheckIcon,
        label: "Open proofs",
        onSelect: () => {
          proofsDrawer.setOpen(true)
          setOpen(false)
        },
        value: "open proofs",
      },
      {
        icon: SparklesIcon,
        label: "Take a tour",
        onSelect: () => {
          setOpen(false)
          resetOnboardingTour()
        },
        value: "take a tour onboarding",
      },
    ]

    const accountItems: CommandActionItem[] = account
      ? [
          {
            icon: BellIcon,
            label: "Open notifications",
            onSelect: () => {
              notifications.setOpen(true)
              setOpen(false)
            },
            value: "open notifications",
          },
          {
            icon: WalletCardsIcon,
            label: "Open wallet menu",
            onSelect: () => {
              walletMenu.setOpen(true)
              setOpen(false)
            },
            value: "open wallet menu",
          },
          {
            icon: LogOutIcon,
            label: "Disconnect wallet",
            onSelect: () => {
              disconnect()
              setOpen(false)
            },
            value: "disconnect wallet",
          },
        ]
      : []

    const result: CommandActionGroup[] = [
      { items: marketItems, key: "markets", label: "Markets" },
      { items: navigationItems, key: "navigation", label: "Navigation" },
      { items: preferenceItems, key: "preferences", label: "Preferences" },
    ]

    if (accountItems.length > 0) {
      result.push({ items: accountItems, key: "account", label: "Account" })
    }

    return result
  }, [
    account,
    activityDrawer,
    disconnect,
    isPrivacyMode,
    notifications,
    proofsDrawer,
    resolvedTheme,
    selectMarket,
    setTheme,
    walletMenu,
  ])

  return (
    <CommandDialog onOpenChange={setOpen} open={open}>
      <div className="mx-auto w-full max-w-xs">
        <button
          className="inline-flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-tour="palette"
          onClick={() => setOpen(true)}
          type="button"
        >
          <span className="flex grow items-center">
            <SearchIcon
              aria-hidden="true"
              className="-ms-1 me-3 size-4 text-muted-foreground/80"
            />
            <span className="font-normal text-muted-foreground/70">Search</span>
          </span>
          <kbd className="ms-12 -me-1 inline-flex h-5 max-h-full items-center rounded border bg-background px-1 font-[inherit] text-[0.625rem] font-medium text-muted-foreground/70">
            ⌘K
          </kbd>
        </button>
      </div>
      <CommandDialogPopup>
        <Command items={groups}>
          <CommandInput placeholder="Search markets, jump to menus, toggle preferences..." />
          <CommandPanel>
            <CommandEmpty>No matching commands.</CommandEmpty>
            <CommandList>
              {(group: CommandActionGroup) => (
                <React.Fragment key={group.key}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: CommandActionItem) => {
                        const Icon = item.icon
                        const isMarket = group.key === "markets"
                        const market = isMarket
                          ? marketCards.find(
                              (candidate) =>
                                getMarketPair(candidate) === item.label
                            )
                          : undefined

                        return (
                          <CommandItem
                            className="gap-2"
                            key={item.label}
                            onClick={item.onSelect}
                            value={item.value}
                          >
                            <Icon
                              aria-hidden="true"
                              className="size-4 opacity-60"
                            />
                            <span className="flex-1">{item.label}</span>
                            {market ? (
                              <MarketBadges market={market} />
                            ) : item.hint ? (
                              <span className="text-xs text-muted-foreground">
                                {item.hint}
                              </span>
                            ) : null}
                          </CommandItem>
                        )
                      }}
                    </CommandCollection>
                  </CommandGroup>
                  <CommandSeparator />
                </React.Fragment>
              )}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

function MarketBadges({
  market,
}: {
  market: MarketCardData
}): React.ReactElement {
  return (
    <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="rounded-md border px-1.5 py-0.5">{market.risk}</span>
      <span className="rounded-md border px-1.5 py-0.5">
        APR {market.borrowApr}
      </span>
    </span>
  )
}
