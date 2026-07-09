import * as React from "react"

import { MarketWorkspace } from "./market-workspace"

export function AppDashboard(): React.ReactElement {
  return (
    <main className="min-h-0 flex-1 overflow-hidden bg-muted/30">
      <section
        aria-label="Lending markets"
        className="h-full min-h-0 w-full"
      >
        <React.Suspense fallback={null}>
          <MarketWorkspace />
        </React.Suspense>
      </section>
    </main>
  )
}
