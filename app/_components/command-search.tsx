"use client"

import { ArrowUpRightIcon, LandmarkIcon, SearchIcon } from "lucide-react"
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

import { useMarketSelection } from "../_hooks/use-market-selection"

type CommandActionItem = {
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
      label: getMarketPair(market),
      onSelect: () => {
        selectMarket(market)
        setOpen(false)
      },
      value: getMarketSearchValue(market),
    }))

    const navigationItems: CommandActionItem[] = [
      {
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
    ]

    return [
      { items: marketItems, key: "markets", label: "Markets" },
      { items: navigationItems, key: "navigation", label: "Navigation" },
    ]
  }, [selectMarket])

  return (
    <CommandDialog onOpenChange={setOpen} open={open}>
      <div className="mx-auto w-full max-w-xs">
        <button
          className="inline-flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          <CommandInput placeholder="Search markets by pair or asset name..." />
          <CommandPanel>
            <CommandEmpty>No markets match.</CommandEmpty>
            <CommandList>
              {(group: CommandActionGroup) => (
                <React.Fragment key={group.key}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: CommandActionItem) => {
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
                            {isMarket ? (
                              <LandmarkIcon
                                aria-hidden="true"
                                className="size-4 opacity-60"
                              />
                            ) : (
                              <ArrowUpRightIcon
                                aria-hidden="true"
                                className="size-4 opacity-60"
                              />
                            )}
                            <span className="flex-1">{item.label}</span>
                            {market ? (
                              <MarketBadges market={market} />
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
