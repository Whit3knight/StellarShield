"use client"

import * as React from "react"

type MenuOpenState = {
  open: boolean
  setOpen: (open: boolean) => void
}

type NavMenusContextValue = {
  activityDrawer: MenuOpenState
  notifications: MenuOpenState
  proofsDrawer: MenuOpenState
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
  const [activityDrawerOpen, setActivityDrawerOpen] = React.useState(false)
  const [proofsDrawerOpen, setProofsDrawerOpen] = React.useState(false)

  const value = React.useMemo<NavMenusContextValue>(
    () => ({
      activityDrawer: {
        open: activityDrawerOpen,
        setOpen: setActivityDrawerOpen,
      },
      notifications: {
        open: notificationsOpen,
        setOpen: setNotificationsOpen,
      },
      proofsDrawer: {
        open: proofsDrawerOpen,
        setOpen: setProofsDrawerOpen,
      },
      walletMenu: {
        open: walletMenuOpen,
        setOpen: setWalletMenuOpen,
      },
    }),
    [
      activityDrawerOpen,
      notificationsOpen,
      proofsDrawerOpen,
      walletMenuOpen,
    ]
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
