import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, type Variants } from "framer-motion"
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  FolderOpen,
  Inbox,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
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
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { AnimatedNumber } from "@/components/AnimatedNumber"
import { OfficerShell } from "@/components/OfficerShell"
import { ComplaintsMap } from "@/components/ComplaintsMap"
import { ComplaintDetailsDialog } from "@/components/ComplaintDetailsDialog"
import { SignOutConfirmationDialog } from "@/components/SignOutConfirmationDialog"
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
  region: string | null
  council_area: string | null
  ward: string | null
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

const entranceContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
}

const entranceItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" } },
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
      <Card className="card-sheen h-full border-border/90 shadow-none transition-colors hover:border-primary/40">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{label}</p>
              <div className="mt-2 min-h-9">
                {typeof value === "number" ? (
                  <AnimatedNumber value={value} />
                ) : (
                  <span className="font-display text-3xl font-semibold tracking-tight tabular-nums">
                    {value}
                  </span>
                )}
              </div>
            </div>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
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
  const [trendRange, setTrendRange] = useState<7 | 14>(14)
  const [showReceived, setShowReceived] = useState(true)
  const [showResolved, setShowResolved] = useState(true)
  const [activeSection, setActiveSection] = useState<"overview" | "map" | "analytics" | "complaints">("overview")
  const [selectedComplaintId, setSelectedComplaintId] = useState<string | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    document.title = "Institution dashboard - GamCiv"
  }, [])

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setPrefersReducedMotion(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    const sections = ["overview", "map", "analytics", "complaints"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null)
    if (!sections.length || !("IntersectionObserver" in window)) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      const sectionId = visible?.target.id
      if (sectionId === "overview" || sectionId === "map" || sectionId === "analytics" || sectionId === "complaints") {
        setActiveSection(sectionId)
      }
    }, { rootMargin: "-140px 0px -55% 0px", threshold: [0, 0.15, 0.4] })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [institution, stats])

  const loadDashboard = useCallback(async (institutionId: string) => {
    setDataLoading(true)
    const controller = new AbortController()
    let timeoutId: number | undefined
    try {
      const [complaintsResult, statsResult] = await Promise.race([
        Promise.all([
          supabase
            .from("complaints")
            .select("id, institution_id, tracking_no, title, status, urgency, region, council_area, ward, created_at, updated_at")
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
      if (!sessionData.session) {
        window.location.replace("/app/login")
        return
      }

      const { data: accessData, error: accessRpcError } = await supabase.rpc("fn_dashboard_access")
      if (cancelled) return
      if (accessRpcError) {
        console.error("Dashboard access check failed:", accessRpcError.message)
        setAccessError("We couldn't confirm your account permissions. Check your connection and retry.")
        setCheckingAccess(false)
        return
      }
      const access = accessData as {
        ok?: boolean
        role?: "admin" | "officer" | "citizen" | null
        institution?: { id?: string; name?: string } | null
      } | null
      if (access?.role === "admin") {
        window.location.replace("/dash")
        return
      }
      if (!access?.ok || access.role !== "officer") {
        window.location.replace("/app/home")
        return
      }
      if (!access.institution?.id) {
        setAccessError("This officer account is not linked to an active institution. Contact your administrator.")
        setCheckingAccess(false)
        return
      }
      const ownInstitution = {
        id: access.institution.id,
        name: access.institution.name || "Your institution",
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
  const visibleTrendData = useMemo(() => trendData.slice(-trendRange), [trendData, trendRange])
  const trendTotals = useMemo(
    () => visibleTrendData.reduce(
      (totals, item) => ({
        received: totals.received + item.received,
        resolved: totals.resolved + item.resolved,
      }),
      { received: 0, resolved: 0 },
    ),
    [visibleTrendData],
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
  const categoryMax = Math.max(1, ...categoryData.map((item) => item.value))

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
      row.status.toLowerCase().includes(query) ||
      (row.council_area ?? "").toLowerCase().includes(query) ||
      (row.region ?? "").toLowerCase().includes(query),
    )
  }, [filter, rows])

  const attentionRows = useMemo(() => {
    const urgencyRank: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
    return (rows ?? [])
      .filter((row) => !["resolved", "closed", "rejected"].includes(row.status))
      .sort((a, b) => {
        const priority = (urgencyRank[a.urgency ?? "normal"] ?? 2) - (urgencyRank[b.urgency ?? "normal"] ?? 2)
        return priority || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
      .slice(0, 5)
  }, [rows])

  function requestSignOut() {
    setSignOutError(null)
    setSignOutOpen(true)
  }

  async function confirmSignOut() {
    setSigningOut(true)
    setSignOutError(null)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setSignOutError("We couldn't sign you out. Check your connection and try again.")
        return
      }
      window.location.replace("/app/login")
    } catch {
      setSignOutError("We couldn't sign you out. Check your connection and try again.")
    } finally {
      setSigningOut(false)
    }
  }

  const signOutDialog = (
    <SignOutConfirmationDialog
      open={signOutOpen}
      onOpenChange={(open) => {
        setSignOutOpen(open)
        if (!open) setSignOutError(null)
      }}
      onConfirm={() => void confirmSignOut()}
      signingOut={signingOut}
      error={signOutError}
    />
  )

  function goToSection(section: "overview" | "map" | "analytics" | "complaints") {
    document.getElementById(section)?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    })
    setActiveSection(section)
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
      <>
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
            <Button onClick={requestSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </main>
      {signOutDialog}
      </>
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
    <>
    <OfficerShell
      institutionName={institution?.name ?? "Your institution"}
      activeSection={activeSection}
      onNavigate={goToSection}
      onRefresh={() => institution && void loadDashboard(institution.id)}
      onSignOut={requestSignOut}
      refreshing={dataLoading}
    >
      <motion.header
        variants={entranceItem}
        initial={prefersReducedMotion ? false : "hidden"}
        animate="visible"
        className="mb-5 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              {dataLoading ? "Syncing live data" : statsError || feedError ? "Limited connection" : "Live institution data"}
            </Badge>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {institution?.name ?? "Institution"} operations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor incoming reports, service demand, and response progress in one place.
          </p>
        </div>
      </motion.header>

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
        id="overview"
        className="scroll-mt-8 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        aria-label="Complaint operations summary"
        variants={entranceContainer}
        initial={prefersReducedMotion ? false : "hidden"}
        animate="visible"
      >
        {statCards.map((item) => (
          <motion.div key={item.label} variants={entranceItem} className="h-full">
            <StatCard {...item} />
          </motion.div>
        ))}
      </motion.section>

      <section id="map" className="mt-6 scroll-mt-24" aria-labelledby="complaint-map-heading">
        <motion.div
          className="grid gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(290px,0.8fr)]"
          variants={entranceContainer}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView="visible"
          viewport={{ once: true, amount: 0.12 }}
        >
          <motion.div variants={entranceItem}>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle id="complaint-map-heading" className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" aria-hidden="true" /> Reports across The Gambia
              </CardTitle>
              <CardDescription>Explore location-tagged cases assigned to your institution. Select a marker to open the report.</CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-5 sm:pt-0">
              <ComplaintsMap
                heightClass="h-[360px] sm:h-[470px]"
                onSelectComplaint={setSelectedComplaintId}
              />
            </CardContent>
          </Card>
          </motion.div>

          <motion.div variants={entranceItem}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="h-5 w-5 text-warn" aria-hidden="true" /> Needs attention
              </CardTitle>
              <CardDescription>Open reports ordered by urgency, then by age.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {attentionRows.length ? attentionRows.map((complaint) => (
                <button
                  key={complaint.id}
                  type="button"
                  onClick={() => setSelectedComplaintId(complaint.id)}
                  aria-label={`Open details for ${complaint.tracking_no}: ${complaint.title}`}
                  className="group w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{complaint.tracking_no}</span>
                    <Badge variant={complaint.urgency === "critical" || complaint.urgency === "high" ? "danger" : "outline"}>
                      {formatLabel(complaint.urgency || "normal")}
                    </Badge>
                  </div>
                  <span className="mt-2 block line-clamp-2 text-sm font-medium group-hover:text-primary">{complaint.title}</span>
                  <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {complaint.council_area || complaint.ward || complaint.region || "Location not provided"}
                    </span>
                    <span className="shrink-0">{timeAgo(complaint.created_at)}</span>
                  </span>
                </button>
              )) : (
                <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 text-center">
                  <CheckCircle2 className="h-7 w-7 text-ok" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium">{dataLoading ? "Loading open reports…" : "No open reports need attention"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">New cases assigned to your institution will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>
          </motion.div>
        </motion.div>
      </section>

      <section id="analytics" className="mt-6 scroll-mt-32" aria-label="Complaint analytics and service demand">
      <motion.div
        className="grid gap-4 xl:grid-cols-2"
        variants={entranceContainer}
        initial={prefersReducedMotion ? false : "hidden"}
        whileInView="visible"
        viewport={{ once: true, amount: 0.12 }}
      >
        <motion.div variants={entranceItem}>
        <ChartCard title="Intake and resolution trend" description="Daily reports received versus resolved">
          {statsError ? (
            <EmptyChart>Trend data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : visibleTrendData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading activity…" : "No trend data yet for your institution."}</EmptyChart>
          ) : (
            <>
              <div className="mb-3 flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trend time range">
                  {([7, 14] as const).map((days) => (
                    <Button
                      key={days}
                      type="button"
                      size="sm"
                      variant={trendRange === days ? "default" : "outline"}
                      aria-pressed={trendRange === days}
                      onClick={() => setTrendRange(days)}
                    >
                      {days} days
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trend series">
                  <Button
                    type="button"
                    size="sm"
                    variant={showReceived ? "outline" : "ghost"}
                    aria-pressed={showReceived}
                    aria-label={`${showReceived ? "Hide" : "Show"} received reports`}
                    onClick={() => setShowReceived((visible) => !visible)}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" /> Received
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={showResolved ? "outline" : "ghost"}
                    aria-pressed={showResolved}
                    aria-label={`${showResolved ? "Hide" : "Show"} resolved reports`}
                    onClick={() => setShowResolved((visible) => !visible)}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm bg-chart-2" aria-hidden="true" /> Resolved
                  </Button>
                </div>
              </div>
              <p className="sr-only" aria-live="polite">
                In the selected {trendRange}-day period, {trendTotals.received} reports were received and {trendTotals.resolved} were resolved.
              </p>
              <ChartContainer
                config={{
                  received: { label: "Received", color: "var(--chart-1)" },
                  resolved: { label: "Resolved", color: "var(--chart-2)" },
                }}
                className="h-[230px] min-h-[230px] w-full sm:h-[260px] sm:min-h-[260px]"
                role="group"
                aria-label={`Complaint trend for the last ${trendRange} days`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart accessibilityLayer data={visibleTrendData} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="receivedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-received)" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="var(--color-received)" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="resolvedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-resolved)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="var(--color-resolved)" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={18} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <Tooltip content={<ChartTooltipContent />} />
                    {showReceived && (
                      <Area type="monotone" dataKey="received" name="Received" stroke="var(--color-received)" strokeWidth={2.5} fill="url(#receivedFill)" activeDot={{ r: 4 }} isAnimationActive={!prefersReducedMotion} animationDuration={260} />
                    )}
                    {showResolved && (
                      <Area type="monotone" dataKey="resolved" name="Resolved" stroke="var(--color-resolved)" strokeWidth={2.5} strokeDasharray="5 3" fill="url(#resolvedFill)" activeDot={{ r: 4 }} isAnimationActive={!prefersReducedMotion} animationDuration={260} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label="Selected period totals">
                <span>Received: <strong className="font-semibold text-foreground tabular-nums">{trendTotals.received}</strong></span>
                <span>Resolved: <strong className="font-semibold text-foreground tabular-nums">{trendTotals.resolved}</strong></span>
              </div>
            </>
          )}
        </ChartCard>
        </motion.div>

        <motion.div variants={entranceItem}>
        <ChartCard title="Workload by status" description="How assigned reports are progressing">
          {statsError ? (
            <EmptyChart>Status data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : statusData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading status data…" : "No cases to summarize yet."}</EmptyChart>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={62} outerRadius={94} paddingAngle={3} stroke="var(--card)" strokeWidth={3} isAnimationActive={!prefersReducedMotion} animationDuration={320}>
                    {statusData.map((entry) => <Cell key={entry.label} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
        </motion.div>

        <motion.div variants={entranceItem}>
        <ChartCard title="Demand by category" description="Most reported service areas assigned here">
          {statsError ? (
            <EmptyChart>Category data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : categoryData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading category data…" : "No category data yet."}</EmptyChart>
          ) : (
            <div className="grid grid-cols-1 gap-x-5 gap-y-3 py-1 sm:grid-cols-2" aria-label="Reports by category">
              {categoryData.map((item, index) => {
                const width = Math.max(6, (item.value / categoryMax) * 100)
                const label = formatLabel(item.label)
                return (
                  <motion.div
                    key={item.label}
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.7 }}
                    transition={{
                      duration: prefersReducedMotion ? 0 : 0.28,
                      delay: prefersReducedMotion ? 0 : index * 0.035,
                      ease: "easeOut",
                    }}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-foreground" title={label}>{label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">{item.value.toLocaleString()}</span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`Reports in ${label}`}
                      aria-valuemin={0}
                      aria-valuemax={categoryMax}
                      aria-valuenow={item.value}
                      className="h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <motion.div
                        initial={prefersReducedMotion ? false : { width: 0 }}
                        whileInView={{ width: `${width}%` }}
                        viewport={{ once: true, amount: 0.7 }}
                        transition={{ duration: prefersReducedMotion ? 0 : 0.42, ease: "easeOut" }}
                        className="h-full rounded-full bg-primary"
                      />
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </ChartCard>
        </motion.div>

        <motion.div variants={entranceItem}>
        <ChartCard title="Submission channels" description="How citizens submitted reports to this institution">
          {statsError ? (
            <EmptyChart>Channel data is unavailable until the analytics service reconnects.</EmptyChart>
          ) : channelData.length === 0 ? (
            <EmptyChart>{dataLoading ? "Loading channel data…" : "No channel data yet."}</EmptyChart>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={channelData} dataKey="value" nameKey="label" innerRadius={62} outerRadius={94} paddingAngle={3} stroke="var(--card)" strokeWidth={3} isAnimationActive={!prefersReducedMotion} animationDuration={320}>
                    {channelData.map((entry) => <Cell key={entry.label} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
        </motion.div>
      </motion.div>
      </section>

      <motion.section
        id="complaints"
        className="mt-8 scroll-mt-32"
        aria-labelledby="recent-complaints-heading"
        initial={prefersReducedMotion ? false : "hidden"}
        whileInView="visible"
        viewport={{ once: true, amount: 0.08 }}
        variants={entranceItem}
      >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 id="recent-complaints-heading" className="font-display text-lg font-semibold">Complaint queue</h2>
              <Badge variant="secondary">{stats ? stats.total : "—"} total</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Review the latest reports assigned to {institution?.name ?? "your institution"}. The total is supplied by the secured analytics service.
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search reference, title, status, or area"
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
                  <TableHead>Issue</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((complaint) => (
                  <TableRow key={complaint.id} className="transition-colors hover:bg-muted/35">
                    <TableCell className="whitespace-nowrap font-mono text-xs">{complaint.tracking_no}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <span className="block truncate font-medium">{complaint.title}</span>
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                      {complaint.council_area || complaint.ward || complaint.region || "Not provided"}
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
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {complaint.updated_at ? timeAgo(complaint.updated_at) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelectedComplaintId(complaint.id)}>
                        <Eye className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> View report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
          <span>Showing {visibleRows.length} of up to 200 newest reports.</span>
          <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Analytics cover all reports assigned here.</span>
        </div>
      </Card>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Complaint records and analytics are limited to {institution?.name ?? "your institution"}.
      </p>
      </motion.section>
      <ComplaintDetailsDialog
        complaintId={selectedComplaintId}
        onOpenChange={(open) => { if (!open) setSelectedComplaintId(null) }}
      />
    </OfficerShell>
    {signOutDialog}
    </>
  )
}
