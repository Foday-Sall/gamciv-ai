import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, type Variants } from "framer-motion"
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Inbox,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { supabase } from "@/lib/secretsClient"

interface ComplaintRow {
  id: string
  institution_id: string
  tracking_no: string
  title: string
  status: string
  urgency: string | null
  created_at: string
  updated_at: string | null
}

interface InstitutionInfo {
  id: string
  name: string
}

interface DashboardStats {
  institution: { id: string; code: string; name: string }
  total: number
  today: number
  open: number
  resolved_week: number
  overdue: number
  avg_resolution_hours: number
  by_status: Array<{ status: string; count: number }>
  by_category: Array<{ category: string; count: number }>
  by_channel: Array<{ channel: string | null; count: number }>
  by_urgency: Array<{ urgency: string; count: number }>
  daily: Array<{ date: string; received: number; resolved: number }>
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

const cardMotion: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
}

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "warning" | "danger" {
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

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function EmptyChart({ children }: { children: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | number
  hint: string
  icon: typeof Inbox
  tone: string
}) {
  return (
    <motion.div variants={cardMotion}>
      <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 font-display text-3xl font-semibold tracking-tight tabular">
                {value}
              </p>
            </div>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

const tooltipStyle = {
  borderRadius: 10,
  borderColor: "var(--border)",
  backgroundColor: "var(--card)",
  color: "var(--card-foreground)",
  fontSize: 12,
}

export default function InstitutionDashboard() {
  const [institution, setInstitution] = useState<InstitutionInfo | null>(null)
  const [rows, setRows] = useState<ComplaintRow[] | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    document.title = "Institution dashboard - GamCiv"
  }, [])

  const loadDashboard = useCallback(async (institutionId: string) => {
    setDataLoading(true)
    const controller = new AbortController()
    let timeoutId: number | undefined
    try {
      const [complaintsResult, statsResult] = await Promise.race([
        Promise.all([
          supabase
            .from("complaints")
            .select("id, institution_id, tracking_no, title, status, urgency, created_at, updated_at")
            .eq("institution_id", institutionId)
            .order("created_at", { ascending: false })
            .limit(200)
            .abortSignal(controller.signal),
          supabase.rpc("fn_institution_dashboard_stats").abortSignal(controller.signal),
        ]),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            controller.abort()
            reject(new Error("Institution dashboard request timed out"))
          }, 8000)
        }),
      ])

      if (complaintsResult.error) {
        console.error("Institution complaint feed request failed:", complaintsResult.error.message)
        setRows([])
        setFeedError("We couldn't load this institution's complaint feed. Check your connection and try again.")
      } else {
        const ownRows = ((complaintsResult.data as ComplaintRow[] | null) ?? [])
          .filter((row) => row.institution_id === institutionId)
        setRows(ownRows)
        setFeedError(null)
      }

      const candidate = statsResult.data as (DashboardStats & { ok?: boolean }) | null
      if (
        statsResult.error ||
        !candidate ||
        candidate.ok === false ||
        candidate.institution?.id !== institutionId
      ) {
        if (statsResult.error) {
          console.error("Institution analytics request failed:", statsResult.error.message)
        }
        setStats(null)
        setStatsError("Institution analytics are temporarily unavailable. Complaint data remains protected and scoped to this institution.")
      } else {
        setStats(candidate)
        setStatsError(null)
      }
    } catch (error) {
      console.error("Institution dashboard connection failed:", error)
      setRows((current) => current ?? [])
      setFeedError("We couldn't reach the service. Check your internet connection and retry.")
      setStats(null)
      setStatsError("Live analytics are unavailable while the connection is interrupted. Retry when you're back online.")
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function verifyAndLoad() {
      setCheckingAccess(true)
      setAccessError(null)
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (cancelled) return
      if (sessionError) {
        setAccessError("We couldn't verify your session. Please try again.")
        setCheckingAccess(false)
        return
      }
      const user = sessionData.session?.user
      if (!user) {
        window.location.href = "/dashboard/login"
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle()
      if (cancelled) return
      if (profileError) {
        console.error("Dashboard role check failed:", profileError.message)
        setAccessError("We couldn't confirm your account permissions. Check your connection and retry.")
        setCheckingAccess(false)
        return
      }
      if (profile?.role === "admin") {
        window.location.href = "/dashboard/"
        return
      }
      if (profile?.role !== "officer") {
        window.location.href = "/app/login"
        return
      }

      const { data: officer, error: officerError } = await supabase
        .from("officers")
        .select("institution_id, is_active, institutions(name)")
        .eq("user_id", user.id)
        .maybeSingle()
      if (cancelled) return
      if (officerError) {
        console.error("Officer institution lookup failed:", officerError.message)
        setAccessError("We couldn't verify your institution assignment. Please retry.")
        setCheckingAccess(false)
        return
      }
      if (!officer?.institution_id || officer.is_active !== true) {
        setAccessError("This officer account is not linked to an active institution. Contact your administrator.")
        setCheckingAccess(false)
        return
      }

      const linkedInstitution = officer.institutions as
        | { name?: string }
        | Array<{ name?: string }>
        | null
      const institutionName = Array.isArray(linkedInstitution)
        ? linkedInstitution[0]?.name
        : linkedInstitution?.name
      const ownInstitution = {
        id: officer.institution_id as string,
        name: institutionName || "Your institution",
      }
      setInstitution(ownInstitution)
      setCheckingAccess(false)
      void loadDashboard(ownInstitution.id)
    }

    void verifyAndLoad().catch((error: unknown) => {
      if (cancelled) return
      console.error("Institution access verification failed:", error)
      setAccessError("We couldn't verify your access because the service could not be reached. Check your connection and retry.")
      setCheckingAccess(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadDashboard])

  useEffect(() => {
    if (!institution?.id) return
    const channel = supabase
      .channel(`institution-dashboard-${institution.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "complaints",
          filter: `institution_id=eq.${institution.id}`,
        },
        () => void loadDashboard(institution.id),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [institution?.id, loadDashboard])

  const trendData = useMemo(
    () => (stats?.daily ?? []).map((item) => ({
      ...item,
      label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
        .format(new Date(`${item.date}T12:00:00Z`)),
    })),
    [stats],
  )

  const statusData = useMemo(
    () => (stats?.by_status ?? [])
      .filter((item) => item.count > 0)
      .map((item, index) => ({
        label: formatLabel(item.status),
        value: item.count,
        fill: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [stats],
  )

  const categoryData = useMemo(
    () => (stats?.by_category ?? [])
      .filter((item) => item.count > 0)
      .slice(0, 8)
      .map((item) => ({ label: item.category, value: item.count })),
    [stats],
  )

  const channelData = useMemo(
    () => (stats?.by_channel ?? [])
      .filter((item) => item.count > 0)
      .map((item, index) => ({
        label: formatLabel(item.channel || "other"),
        value: item.count,
        fill: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [stats],
  )

  const visibleRows = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return rows ?? []
    return (rows ?? []).filter((row) =>
      row.title.toLowerCase().includes(query) ||
      row.tracking_no.toLowerCase().includes(query) ||
      row.status.toLowerCase().includes(query),
    )
  }, [filter, rows])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = "/dashboard/login"
  }

  if (checkingAccess) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-10 md:px-6" aria-busy="true">
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </main>
    )
  }

  if (accessError) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-4 py-10">
        <Card className="w-full">
          <CardHeader className="items-center text-center">
            <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
            </span>
            <CardTitle>Institution access unavailable</CardTitle>
            <CardDescription>{accessError}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
            <Button onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const statCards = [
    {
      label: "Total complaints",
      value: stats?.total ?? "—",
      hint: "All reports assigned to your institution",
      icon: Inbox,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "New today",
      value: stats?.today ?? "—",
      hint: "Received since midnight",
      icon: CalendarDays,
      tone: "bg-info/10 text-info",
    },
    {
      label: "Open cases",
      value: stats?.open ?? "—",
      hint: "Awaiting resolution or next action",
      icon: FolderOpen,
      tone: "bg-warn/10 text-warn",
    },
    {
      label: "Resolved this week",
      value: stats?.resolved_week ?? "—",
      hint: "Closed in the last 7 days",
      icon: CheckCircle2,
      tone: "bg-ok/10 text-ok",
    },
    {
      label: "Overdue cases",
      value: stats?.overdue ?? "—",
      hint: "Past the response deadline",
      icon: Clock3,
      tone: "bg-danger/10 text-danger",
    },
  ]

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-7 md:px-6 md:py-9">
      <section className="mb-6 overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-card to-card shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Activity className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {institution?.name ?? "Institution dashboard"}
                </h1>
                <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Institution only
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Your complaint workload, response trends, and service performance.
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
                </span>
                Live updates · charts are scoped to {institution?.name ?? "your institution"}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="outline"
              onClick={() => institution && void loadDashboard(institution.id)}
              disabled={dataLoading || !institution}
            >
              {dataLoading
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh data
            </Button>
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </section>

      {statsError && (
        <Card className="mb-5 border-warn/30 bg-warn/5" role="status">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground">{statsError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => institution && void loadDashboard(institution.id)}
              disabled={dataLoading}
            >
              Retry analytics
            </Button>
          </CardContent>
        </Card>
      )}

      {feedError && (
        <Card className="mb-5 border-destructive/25 bg-destructive/5" role="alert">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">{feedError}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => institution && void loadDashboard(institution.id)}
              disabled={dataLoading}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <motion.section
        initial="hidden"
        animate="shown"
        variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.055 } } }}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        aria-label="Institution complaint summary"
      >
        {statCards.map((item) => (
          <StatCard key={item.label} {...item} />
        ))}
      </motion.section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Complaint trend" description="Reports received and resolved · last 14 days">
          {statsError ? (
            <EmptyChart>Trend data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : trendData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading activity…" : "No trend data yet for your institution."}</EmptyChart>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="received" name="Received" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="resolved" name="Resolved" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Case status" description="How your institution's assigned workload is progressing">
          {statsError ? (
            <EmptyChart>Status data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : statusData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading status data…" : "No cases to summarize yet."}</EmptyChart>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={62} outerRadius={94} paddingAngle={3} stroke="var(--card)" strokeWidth={3} isAnimationActive={false}>
                    {statusData.map((entry) => <Cell key={entry.label} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Complaints by category" description="Most reported categories assigned to this institution">
          {statsError ? (
            <EmptyChart>Category data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : categoryData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading category data…" : "No category data yet."}</EmptyChart>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="4 4" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(value) => String(value).length > 19 ? `${String(value).slice(0, 18)}…` : String(value)} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" name="Complaints" fill="var(--chart-1)" radius={[0, 7, 7, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Intake channels" description="How complaints assigned to your institution were submitted">
          {statsError ? (
            <EmptyChart>Channel data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : channelData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading channel data…" : "No channel data yet."}</EmptyChart>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={channelData} dataKey="value" nameKey="label" innerRadius={62} outerRadius={94} paddingAngle={3} stroke="var(--card)" strokeWidth={3} isAnimationActive={false}>
                    {channelData.map((entry) => <Cell key={entry.label} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-display text-lg font-semibold">Recent complaints</h2>
              <Badge variant="secondary">{stats ? stats.total : "—"} total</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest reports assigned to {institution?.name ?? "your institution"}; the full count above comes from the secured analytics API.
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search reference, title, status"
              className="pl-9"
              aria-label="Search this institution's complaints"
            />
          </div>
        </div>
        {rows === null ? (
          <div className="space-y-3 p-6" aria-busy="true">
            {[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-md bg-muted/50" />)}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
            {filter ? <Search className="h-8 w-8 text-muted-foreground" /> : <Inbox className="h-8 w-8 text-muted-foreground" />}
            <p className="font-medium">{filter ? "No matching complaints" : "No complaints yet"}</p>
            <p className="text-sm text-muted-foreground">
              {filter ? "Try a different search term." : `New reports assigned to ${institution?.name ?? "your institution"} will appear here.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Complaint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((complaint) => (
                  <TableRow key={complaint.id} className="transition-colors hover:bg-muted/35">
                    <TableCell className="whitespace-nowrap font-mono text-xs">{complaint.tracking_no}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <span className="block truncate font-medium">{complaint.title}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(complaint.status)}>{formatLabel(complaint.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        complaint.urgency === "critical" || complaint.urgency === "high"
                          ? "border-danger/25 bg-danger/5 text-danger"
                          : complaint.urgency === "low"
                            ? "text-muted-foreground"
                            : "border-info/25 bg-info/5 text-info"
                      }>
                        {formatLabel(complaint.urgency || "normal")}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{timeAgo(complaint.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm text-muted-foreground">
                      {complaint.updated_at ? timeAgo(complaint.updated_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
          <span>Showing {visibleRows.length} of up to 200 recent records in this table.</span>
          <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Analytics use all institution records.</span>
        </div>
      </Card>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        This workspace only displays complaint records and aggregates for {institution?.name ?? "your institution"}.
      </p>
    </main>
  )
}
