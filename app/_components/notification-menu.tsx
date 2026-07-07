"use client"

import { BellIcon } from "lucide-react"
import * as React from "react"

import {
  initialNotifications,
  type Notification,
} from "../_constants/notifications"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

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
  const [notifications, setNotifications] = React.useState(initialNotifications)
  const unreadCount = notifications.filter((notification) => {
    return notification.unread
  }).length

  const handleMarkAllAsRead = React.useCallback(() => {
    setNotifications((currentNotifications) => {
      return currentNotifications.map((notification) => ({
        ...notification,
        unread: false,
      }))
    })
  }, [])

  const handleNotificationClick = React.useCallback((id: number) => {
    setNotifications((currentNotifications) => {
      return currentNotifications.map((notification) => {
        if (notification.id === id) {
          return { ...notification, unread: false }
        }

        return notification
      })
    })
  }, [])

  return (
    <Popover>
      <PopoverTrigger
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
                  onClick={() => {
                    handleNotificationClick(notification.id)
                  }}
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
                  {notification.timestamp}
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
