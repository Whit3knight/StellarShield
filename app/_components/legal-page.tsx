import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import type * as React from "react"

import { BrandLogo } from "@/components/brand-logo"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export type LegalSection = {
  heading: string
  body: React.ReactNode
}

export function LegalPage({
  title,
  lastUpdated,
  intro,
  sections,
}: {
  title: string
  lastUpdated: string
  intro?: React.ReactNode
  sections: LegalSection[]
}): React.ReactElement {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background px-4 md:px-6">
        <div className="flex h-16 items-center">
          <Link
            aria-label="Stellar Shield home"
            className="text-primary hover:text-primary/90"
            href="/"
          >
            <BrandLogo />
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-12">
          <Alert className="mb-8" variant="warning">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Testnet — no real value</AlertTitle>
            <AlertDescription>Draft pending legal counsel.</AlertDescription>
          </Alert>

          <div className="mb-8">
            <h1 className="font-heading font-semibold text-2xl text-foreground tracking-tight">
              {title}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Last updated {lastUpdated}
            </p>
          </div>

          {intro ? (
            <div className="mb-8 space-y-3 text-pretty text-foreground text-sm leading-relaxed [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2">
              {intro}
            </div>
          ) : null}

          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.heading || "closing"}>
                {section.heading ? (
                  <h2 className="mb-2 font-heading font-semibold text-foreground text-lg">
                    {section.heading}
                  </h2>
                ) : null}
                <div className="space-y-3 text-pretty text-muted-foreground text-sm leading-relaxed [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
                  {section.body}
                </div>
              </section>
            ))}
          </div>

          <footer className="mt-12 border-t pt-6 text-muted-foreground text-sm">
            <Link
              className="font-medium text-primary underline underline-offset-2"
              href="/"
            >
              Return to dashboard
            </Link>
          </footer>
        </div>
      </main>
    </div>
  )
}
