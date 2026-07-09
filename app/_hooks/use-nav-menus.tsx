"use client"

import * as React from "react"

type NavMenusContextValue = {
  notifications: {
    open: boolean
    setOpen: (open: boolean) => void
  }
}

const NavMenusContext = React.createContext<NavMenusContextValue | null>(null)

export function NavMenusProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)

  const value = React.useMemo<NavMenusContextValue>(
    () => ({
      notifications: {
        open: notificationsOpen,
        setOpen: setNotificationsOpen,
      },
    }),
    [notificationsOpen]
  )

  return (
    <NavMenusContext.Provider value={value}>
      {children}
    </NavMenusContext.Provider>
  )
}

export function useNavMenus(): NavMenusContextValue {
  const value = React.useContext(NavMenusContext)

  if (!value) {
    throw new Error("useNavMenus must be used within a NavMenusProvider")
  }

  return value
}
