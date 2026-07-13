import {
  ActivityIcon,
  BookOpenIcon,
  FileCheckIcon,
  FileTextIcon,
  LifeBuoyIcon,
  ShieldCheckIcon,
} from "lucide-react"
import type * as React from "react"

import { appRoutes } from "./routes"

export type UserMenuLink = {
  href: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
}

export const userAppLinks: UserMenuLink[] = [
  {
    href: appRoutes.proofs,
    icon: ShieldCheckIcon,
    label: "Proofs",
  },
  {
    href: appRoutes.activity,
    icon: ActivityIcon,
    label: "Activity",
  },
]

export const userResourceLinks: UserMenuLink[] = [
  {
    href: appRoutes.docs,
    icon: BookOpenIcon,
    label: "Docs",
  },
  {
    href: appRoutes.terms,
    icon: FileTextIcon,
    label: "Terms & Conditions",
  },
  {
    href: appRoutes.privacySecurity,
    icon: ShieldCheckIcon,
    label: "Privacy & Security",
  },
  {
    href: appRoutes.audit,
    icon: FileCheckIcon,
    label: "Security Audit",
  },
  {
    href: appRoutes.support,
    icon: LifeBuoyIcon,
    label: "Support",
  },
]
