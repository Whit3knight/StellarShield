import * as React from "react"

import { BrandLogo } from "@/components/brand-logo"

import { CommandSearch } from "./command-search"
import { WalletNavActions } from "./wallet-nav-actions"

export function AppNavbar(): React.ReactElement {
  return (
    <header className="shrink-0 border-b bg-background px-4 md:px-6">
      <div className="flex h-16 items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-2">
          <div className="flex items-center">
            <a
              aria-label="Stellar Shield home"
              className="text-primary hover:text-primary/90"
              href="#"
            >
              <BrandLogo />
            </a>
          </div>
        </div>

        <div className="grow">
          <React.Suspense fallback={null}>
            <CommandSearch />
          </React.Suspense>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <WalletNavActions />
        </div>
      </div>
    </header>
  )
}
