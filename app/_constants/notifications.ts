import {
  CoinsIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react"

export type NotificationKind = "borrow" | "repay"

export type Notification = {
  action: string
  createdAt: string
  hash?: string
  icon: LucideIcon
  id: string
  kind: NotificationKind
  target: string
  unread: boolean
  user: string
}

const KIND_DEFAULTS: Record<
  NotificationKind,
  { action: string; icon: LucideIcon; user: string }
> = {
  borrow: {
    action: "confirmed",
    icon: ShieldCheckIcon,
    user: "Stellar Shield",
  },
  repay: {
    action: "closed",
    icon: CoinsIcon,
    user: "Stellar Shield",
  },
}

export function createChainNotification({
  createdAt,
  hash,
  id,
  kind,
}: {
  createdAt?: string
  hash?: string
  id?: string
  kind: NotificationKind
}): Notification {
  const defaults = KIND_DEFAULTS[kind]
  const stamp = createdAt ?? new Date().toISOString()
  const label = hash ? `${hash.slice(0, 10)}…` : kind === "borrow" ? "position" : "position"
  return {
    action: defaults.action,
    createdAt: stamp,
    hash,
    icon: defaults.icon,
    id: id ?? `${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    target: kind === "borrow" ? `Borrow ${label}` : `Repay ${label}`,
    unread: true,
    user: defaults.user,
  }
}

export const initialNotifications: Notification[] = []
