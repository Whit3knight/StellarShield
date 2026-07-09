"use client"

import * as React from "react"

type MenuOpenState = {
  open: boolean
  setOpen: (open: boolean) => void
}

type NavMenusContextValue = {
  notifications: MenuOpenState
  walletDetail: MenuOpenState
  walletMenu: MenuOpenState
}

const NavMenusContext = React.createContext<NavMenusContextValue | null>(null)

export function NavMenusProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  const [walletMenuOpen, setWalletMenuOpen] = React.useState(false)
  const [walletDetailOpen, setWalletDetailOpen] = React.useState(false)

  const value = React.useMemo<NavMenusContextValue>(
    () => ({
      notifications: {
        open: notificationsOpen,
        setOpen: setNotificationsOpen,
      },
      walletDetail: {
        open: walletDetailOpen,
        setOpen: setWalletDetailOpen,
      },
      walletMenu: {
        open: walletMenuOpen,
        setOpen: setWalletMenuOpen,
      },
    }),
    [notificationsOpen, walletDetailOpen, walletMenuOpen]
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
