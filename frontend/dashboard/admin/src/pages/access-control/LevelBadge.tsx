import { Badge } from "@/components/ui/badge"
import type { AccessLimits } from "@/lib/adminApi"

/** Access level badge shown next to each institution. */
export default function LevelBadge({ level }: { level: AccessLimits["accessLevel"] }) {
  const variant = level === "full" ? "success" : level === "restricted" ? "warning" : "info"
  return <Badge variant={variant}>{level}</Badge>
}
