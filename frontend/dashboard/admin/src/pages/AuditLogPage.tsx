import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { ScrollText, User, Settings2, Shield, PauseCircle, PlayCircle, ClipboardList } from "lucide-react"

import { getAuditLog, type AuditEntry } from "@/lib/adminApi"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

const TYPE_META: Record<
  AuditEntry["type"],
  { label: string; variant: "success" | "danger" | "warning" | "info"; Icon: typeof ScrollText }
> = {
  created: { label: "Created", variant: "success", Icon: ClipboardList },
  updated: { label: "Updated", variant: "info", Icon: Settings2 },
  suspended: { label: "Suspended", variant: "danger", Icon: PauseCircle },
  reactivated: { label: "Reactivated", variant: "success", Icon: PlayCircle },
  access_changed: { label: "Access changed", variant: "warning", Icon: Shield },
  settings_changed: { label: "Settings", variant: "info", Icon: Settings2 },
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    getAuditLog().then((data) => {
      if (alive) setEntries(data)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every administrative action, newest first. Only the Administrator acts here."
      />

      <Card>
        <CardContent className="pt-6">
          {entries ? (
            <div className="relative">
              <div className="absolute bottom-2 left-[19px] top-2 w-px bg-border" aria-hidden="true" />
              <div className="grid gap-6">
                {entries.map((entry, index) => {
                  const meta = TYPE_META[entry.type]
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03, duration: 0.2 }}
                      className="relative flex gap-4"
                    >
                      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                        <meta.Icon aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          <span className="text-xs text-muted-foreground">{formatTime(entry.at)}</span>
                        </div>
                        <p className="mt-1 text-sm">
                          <span className="font-medium">{entry.actor}</span>
                          <span className="text-muted-foreground"> · </span>
                          {entry.action.toLowerCase()}
                        </p>
                        <p className="text-sm text-muted-foreground">Target: {entry.target}</p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
              <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                <User aria-hidden="true" strokeWidth={1.75} className="h-3.5 w-3.5" />
                <span>
                  Entries reflect the single-administrator model: the actor is always the Administrator or an
                  institution sign-in.
                </span>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
