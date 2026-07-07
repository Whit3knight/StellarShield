"use client"

import { SearchIcon } from "lucide-react"
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
  CommandShortcut,
} from "@/components/ui/command"

import {
  commandActionGroups,
  type CommandAction,
  type CommandActionGroup,
} from "../_constants/command-actions"

export function CommandSearch(): React.ReactElement {
  const [open, setOpen] = React.useState(false)

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

  function handleItemClick() {
    setOpen(false)
  }

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
        <Command items={commandActionGroups}>
          <CommandInput placeholder="Search pools, positions, or proofs..." />
          <CommandPanel>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandList>
              {(group: CommandActionGroup) => (
                <React.Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.value}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: CommandAction) => {
                        const Icon = item.icon

                        return (
                          <CommandItem
                            className="gap-2"
                            key={item.value}
                            onClick={handleItemClick}
                            value={item.value}
                          >
                            <Icon
                              aria-hidden="true"
                              className="size-4 opacity-60"
                            />
                            <span className="flex-1">{item.label}</span>
                            {item.shortcut ? (
                              <CommandShortcut className="justify-center">
                                {item.shortcut}
                              </CommandShortcut>
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
