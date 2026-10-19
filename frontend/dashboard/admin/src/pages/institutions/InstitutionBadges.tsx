import { Badge } from "@/components/ui/badge"
import type { Institution } from "@/lib/adminApi"

/** Access level badge: full, restricted or view-only. */
export function AccessBadge({ level }: { level: Institution["accessLevel"] }) {
  const variant = level === "full" ? "success" : level === "restricted" ? "warning" : "info"
  return <Badge variant={variant}>{level}</Badge>
}

/** Status badge: active or suspended. */
export function StatusBadge({ status }: { status: Institution["status"] }) {
  return (
    <Badge variant={status === "active" ? "success" : "danger"}>
      {status === "active" ? "Active" : "Suspended"}
    </Badge>
  )
}
