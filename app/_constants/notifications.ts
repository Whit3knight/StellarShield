import {
  CircleAlertIcon,
  FileCheck2Icon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react"
import type * as React from "react"

export type Notification = {
  action: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  id: number
  target: string
  timestamp: string
  unread: boolean
  user: string
}

export const initialNotifications: Notification[] = [
  {
    action: "verified",
    icon: ShieldCheckIcon,
    id: 1,
    target: "Borrow proof #42",
    timestamp: "15 minutes ago",
    unread: true,
    user: "Shield Oracle",
  },
  {
    action: "updated risk on",
    icon: CircleAlertIcon,
    id: 2,
    target: "XLM collateral pool",
    timestamp: "45 minutes ago",
    unread: true,
    user: "Risk monitor",
  },
  {
    action: "confirmed",
    icon: WalletIcon,
    id: 3,
    target: "Wallet delegation",
    timestamp: "4 hours ago",
    unread: false,
    user: "Stellar network",
  },
  {
    action: "published",
    icon: FileCheck2Icon,
    id: 4,
    target: "New privacy attestation",
    timestamp: "12 hours ago",
    unread: false,
    user: "Proof center",
  },
  {
    action: "improved health for",
    icon: TrendingUpIcon,
    id: 5,
    target: "Borrow position",
    timestamp: "2 days ago",
    unread: false,
    user: "Position manager",
  },
  {
    action: "mentioned you in",
    icon: UserIcon,
    id: 6,
    target: "Support ticket #18",
    timestamp: "2 weeks ago",
    unread: false,
    user: "Support desk",
  },
]
