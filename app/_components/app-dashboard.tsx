import type * as React from "react"

import { MarketWorkspace } from "./market-workspace"

export function AppDashboard(): React.ReactElement {
  return (
    <main className="min-h-[calc(100svh-4rem)] w-full bg-muted/30">
      <section
        aria-label="Lending markets"
        className="min-h-[calc(100svh-4rem)] w-full"
      >
        <MarketWorkspace />
      </section>
    </main>
  )
}
