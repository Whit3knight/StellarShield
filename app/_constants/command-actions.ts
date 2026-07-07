import {
  ArrowUpRightIcon,
  CircleFadingPlusIcon,
  FileInputIcon,
  FolderPlusIcon,
} from "lucide-react"
import type * as React from "react"

export type CommandAction = {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  shortcut?: string
  value: string
}

export type CommandActionGroup = {
  items: CommandAction[]
  value: "Quick start" | "Navigation"
}

export const commandActionGroups: CommandActionGroup[] = [
  {
    value: "Quick start",
    items: [
      {
        icon: FolderPlusIcon,
        label: "Supply collateral",
        shortcut: "⌘S",
        value: "supply-collateral",
      },
      {
        icon: FileInputIcon,
        label: "Import proof request",
        shortcut: "⌘I",
        value: "import-proof-request",
      },
      {
        icon: CircleFadingPlusIcon,
        label: "Open borrow position",
        shortcut: "⌘B",
        value: "open-borrow-position",
      },
    ],
  },
  {
    value: "Navigation",
    items: [
      {
        icon: ArrowUpRightIcon,
        label: "Go to markets",
        value: "go-to-markets",
      },
      {
        icon: ArrowUpRightIcon,
        label: "Go to positions",
        value: "go-to-positions",
      },
      {
        icon: ArrowUpRightIcon,
        label: "Go to proof center",
        value: "go-to-proof-center",
      },
    ],
  },
]
