"use client"

import * as React from "react"

type MenuOpenState = {
  open: boolean
  setOpen: (open: boolean) => void
}

type NavMenusContextValue = {
  activityDrawer: MenuOpenState
  connectDialog: MenuOpenState
  notifications: MenuOpenState
  positionsDrawer: MenuOpenState
  proofsDrawer: MenuOpenState
  shieldedDrawer: MenuOpenState
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
  const [connectDialogOpen, setConnectDialogOpen] = React.useState(false)
  const [positionsDrawerOpen, setPositionsDrawerOpen] = React.useState(false)
  const [shieldedDrawerOpen, setShieldedDrawerOpen] = React.useState(false)

  const value = React.useMemo<NavMenusContextValue>(
    () => ({
      activityDrawer: {
        open: activityDrawerOpen,
        setOpen: setActivityDrawerOpen,
      },
      connectDialog: {
        open: connectDialogOpen,
        setOpen: setConnectDialogOpen,
      },
      notifications: {
        open: notificationsOpen,
        setOpen: setNotificationsOpen,
      },
      positionsDrawer: {
        open: positionsDrawerOpen,
        setOpen: setPositionsDrawerOpen,
      },
      proofsDrawer: {
        open: proofsDrawerOpen,
        setOpen: setProofsDrawerOpen,
      },
      shieldedDrawer: {
        open: shieldedDrawerOpen,
        setOpen: setShieldedDrawerOpen,
      },
      walletMenu: {
        open: walletMenuOpen,
        setOpen: setWalletMenuOpen,
      },
    }),
    [
      activityDrawerOpen,
      connectDialogOpen,
      notificationsOpen,
      positionsDrawerOpen,
      proofsDrawerOpen,
      shieldedDrawerOpen,
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
