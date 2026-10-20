/**
 * InstitutionDashboard — role=officer view at /dashboard/institute.
 *
 * The officer signs in (OTP or password) and sees ONLY their own
 * institution's complaints. The REST read goes through the
 * comp_select_officer_own_inst RLS policy, so the server filters by the
 * officers table (user_id -> institution_id) — the UI just renders what the
 * session is allowed to see and adds simple stat cards.
 *
 * Data comes straight from PostgREST with the officer session (no edge
 * function, no service role), reusing the admin console's components.
 */
import { useEffect, useMemo, useState } from "react"
import { motion, type Variants } from "framer-motion"
import { Inbox, FolderOpen, Clock, CheckCircle2, ArrowUpRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { supabase } from "@/lib/secretsClient"

export interface ComplaintRow {
  id: string
  tracking_no: string
  title: string
  status: string
  urgency: string | null
  created_at: string
  updated_at: string | null
}

export interface InstitutionInfo {
  id: string
  name: string
}

/** Statuses the platform treats as "open" (still needs action). */
export const OPEN_STATUSES = new Set([
  "submitted",
  "received",
  "in_progress",
  "waiting_info",
  "forwarded",
  "escalated",
  "reopened",
])

export function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "warning" | "danger" {
  switch (status) {
    case "in_progress":
      return "default"
    case "waiting_info":
      return "outline"
    case "escalated":
      return "danger"
    case "reopened":
      return "warning"
    case "closed":
      return "secondary"
    default:
      return "secondary"
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const containerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
}

const STAT_META = [
  { key: "total", label: "Total complaints", Icon: Inbox },
  { key: "open", label: "Open complaints", Icon: FolderOpen },
  { key: "escalated", label: "Escalated", Icon: ArrowUpRight },
  { key: "closed", label: "Closed", Icon: CheckCircle2 },
] as const

export default function InstitutionDashboard() {
  const [institution, setInstitution] = useState<InstitutionInfo | null>(null)
  const [rows, setRows] = useState<ComplaintRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    document.title = "Institution dashboard - GamCiv"
  }, [])

  // Load the officer's institution (via officers table) + complaints (RLS-scoped).
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        window.location.href = "/login"
        return
      }
      // The officers row for this user pins the institution name and id.
      const { data: officer } = await supabase
        .from("officers")
        .select("institution_id, institutions(name)")
        .eq("user_id", user.id)
        .maybeSingle()
      if (cancelled) return
      const instId = officer?.institution_id as string | undefined
      const instName = (officer?.institutions as { name?: string } | null)?.name
      if (instId) setInstitution({ id: instId, name: instName || "Your institution" })
      // Complaints read: the RLS policy comp_select_officer_own_inst limits
      // rows to the officer's own institution — select is explicitly public
      // columns only (tracking/title/status), never citizen personal data.
      const { data: complaints, error } = await supabase
        .from("complaints")
        .select("id, tracking_no, title, status, urgency, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(200)
      if (cancelled) return
      if (error) {
        setLoadFailed(true)
        setRows([])
        return
      }
      setLoadFailed(false)
      setRows((complaints as ComplaintRow[]) ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    if (!rows) return null
    return {
      total: rows.length,
      open: rows.filter((r) => OPEN_STATUSES.has(r.status)).length,
      escalated: rows.filter((r) => r.status === "escalated").length,
      closed: rows.filter((r) => r.status === "closed").length,
    }
  }, [rows])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = "/login"
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
          A
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">
            {institution?.name ?? "Institution dashboard"}
          </p>
          <p className="truncate text-xs text-muted-foreground">GamCiv institution view</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {institution?.name ?? "Institution dashboard"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complaints assigned to your institution. Only staff of this agency can see this page.
          </p>
        </div>

        {loadFailed && (
          <Card className="mb-6">
            <CardContent className="p-6 text-sm text-destructive">
              Could not load complaints. Check your connection and reload the page.
            </CardContent>
          </Card>
        )}

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="shown"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {STAT_META.map(({ key, label, Icon }) => (
            <motion.div key={key} variants={itemVariants}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="tabular font-display text-3xl font-semibold tracking-tight">
                      {stats ? stats[key] : "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
              <div>
                <h2 className="font-display text-base font-semibold">Complaints</h2>
                <p className="text-xs text-muted-foreground">Newest first</p>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">Live data</span>
              </div>
            </div>
            {rows === null ? (
              <div className="space-y-2 p-6">
                {[0, 1, 2].map((key) => (
                  <div key={key} className="h-10 rounded-md bg-muted/40" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                No complaints yet for this institution.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <motion.tr
                      key={c.id}
                      variants={{ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } }}
                      className="border-b border-border transition-colors hover:bg-muted/40"
                    >
                      <TableCell className="tabular font-mono text-xs">{c.tracking_no}</TableCell>
                      <TableCell className="max-w-md">
                        <p className="truncate font-medium">{c.title}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(c.status)}>
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {timeAgo(c.created_at)}
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </main>
    </div>
  )
}
