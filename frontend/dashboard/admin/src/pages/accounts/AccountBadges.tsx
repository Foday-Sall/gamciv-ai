import { Badge } from "@/components/ui/badge"
import type { Officer, OfficerRole } from "@/lib/adminApi"

export const ROLE_LABELS: Record<OfficerRole, string> = {
  "institution-admin": "Institution admin",
  officer: "Officer",
  "view-only": "View only",
}

/** Role badge for an account row. */
export default function RoleBadge({ role }: { role: OfficerRole }) {
  const variant = role === "institution-admin" ? "success" : role === "officer" ? "default" : "info"
  return <Badge variant={variant}>{ROLE_LABELS[role]}</Badge>
}

export type IssuedAccount = { officer: Officer; temporaryPassword: string }
