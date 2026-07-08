import { Geist_Mono, Manrope } from "next/font/google"

import "./globals.css"
import { appPreferenceKeys } from "./_constants/preferences"

import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const manropeHeading = Manrope({
  subsets: ["latin"],
  variable: "--font-heading",
})

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" })

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

const privacyModeScript = `try{if(localStorage.getItem(${JSON.stringify(
  appPreferenceKeys.privacyMode
)})==="true"){document.documentElement.dataset.privacyMode="true"}}catch{}`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        "font-sans",
        manrope.variable,
        manropeHeading.variable,
        geistMono.variable
      )}
    >
      <body>
        <script
          dangerouslySetInnerHTML={{ __html: privacyModeScript }}
          suppressHydrationWarning
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
