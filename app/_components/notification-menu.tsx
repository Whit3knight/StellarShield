"use client"

import { BellIcon, InboxIcon } from "lucide-react"
import * as React from "react"

import {
  createChainNotification,
  initialNotifications,
  type Notification,
} from "../_constants/notifications"
import { useNavMenus } from "../_hooks/use-nav-menus"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  onBorrowConfirmed,
  onRepayConfirmed,
} from "@/features/borrow-flow/borrow-events"
import { getStellarExpertTxUrl } from "@/features/wallet/network"

const NOTIFICATION_CAP = 20

function Dot({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height="6"
      viewBox="0 0 6 6"
      width="6"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="3" cy="3" r="3" />
    </svg>
  )
}

function NotificationIcon({
  notification,
}: {
  notification: Notification
}): React.ReactElement {
  const Icon = notification.icon
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
      <Icon aria-hidden="true" className="size-4" />
    </span>
  )
}

export function NotificationMenu(): React.ReactElement {
  const [notifications, setNotifications] = React.useState<Notification[]>(
    initialNotifications
  )
  const { notifications: notificationsMenu } = useNavMenus()

  const unreadCount = notifications.reduce(
    (acc, item) => acc + (item.unread ? 1 : 0),
    0
  )

  React.useEffect(() => {
    const push = (kind: Notification["kind"], hash?: string) => {
      setNotifications((current) =>
        [
          createChainNotification({ hash, kind }),
          ...current,
        ].slice(0, NOTIFICATION_CAP)
      )
    }

    const offBorrow = onBorrowConfirmed((hash) => push("borrow", hash))
    const offRepay = onRepayConfirmed((hash) => push("repay", hash))

    return () => {
      offBorrow()
      offRepay()
    }
  }, [])

  const handleMarkAllAsRead = React.useCallback(() => {
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, unread: false }))
    )
  }, [])

  const handleNotificationClick = React.useCallback(
    (notification: Notification) => {
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, unread: false } : item
        )
      )
      if (notification.hash) {
        window.open(getStellarExpertTxUrl(notification.hash), "_blank")
      }
    },
    []
  )

  return (
    <Popover
      onOpenChange={notificationsMenu.setOpen}
      open={notificationsMenu.open}
    >
      <PopoverTrigger
        data-tour="notifications"
        render={
          <Button
            aria-label="Open notifications"
            className="relative"
            size="icon"
            variant="ghost"
          />
        }
      >
        <BellIcon aria-hidden="true" />
        {unreadCount > 0 ? (
          <Badge className="absolute -top-2 left-full min-w-5 -translate-x-1/2 px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex items-baseline justify-between gap-4 px-3 py-2">
          <div className="text-sm font-semibold">Notifications</div>
          {unreadCount > 0 ? (
            <button
              className="text-xs font-medium hover:underline"
              onClick={handleMarkAllAsRead}
              type="button"
            >
              Mark all as read
            </button>
          ) : null}
        </div>
        <div
          aria-orientation="horizontal"
          className="-mx-1 my-1 h-px bg-border"
          role="separator"
          tabIndex={-1}
        />
        {notifications.length === 0 ? <EmptyState /> : null}
        {notifications.map((notification) => (
          <div
            className="rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
            key={notification.id}
          >
            <div className="relative flex items-start gap-3 pe-3">
              <NotificationIcon notification={notification} />
              <div className="flex-1 space-y-1">
                <button
                  className="text-left text-foreground/80 after:absolute after:inset-0"
                  onClick={() => handleNotificationClick(notification)}
                  type="button"
                >
                  <span className="font-medium text-foreground hover:underline">
                    {notification.user}
                  </span>{" "}
                  {notification.action}{" "}
                  <span className="font-medium text-foreground hover:underline">
                    {notification.target}
                  </span>
                  .
                </button>
                <div className="text-xs text-muted-foreground">
                  {formatRelative(notification.createdAt)}
                </div>
              </div>
              {notification.unread ? (
                <div className="absolute end-0 self-center">
                  <Dot />
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
      <InboxIcon aria-hidden="true" className="size-6 opacity-60" />
      <span>Nothing new yet.</span>
      <span className="text-xs">
        Confirmed borrows and repays land here.
      </span>
    </div>
  )
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 45) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
