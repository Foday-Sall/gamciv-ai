/**
 * InstituteDashboard — the home page for institutional users (staff) inside
 * the citizen app. Lives under the shared AppShell; replaces the citizen home
 * content for users with a row in the `officers` table.
 *
 * A live analytics view over the institution's complaints:
 *  - stat cards (today / open / resolved this week / avg resolution time),
 *  - a bar chart of complaints per category (last 7 days) and an area chart
 *    of complaints per day, computed client-side from the same query,
 *  - a live complaints feed driven by a Supabase Realtime subscription
 *    (INSERT + UPDATE on `complaints`, filtered by institution_id).
 *
 * Actions call the existing officer RPCs (backend/db/0004_officer.sql,
 * 0005_escalation.sql): accept, reject, request info, set status, attach
 * proof and forward.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Bar, BarChart, CartesianGrid, Area, AreaChart, XAxis } from 'recharts'
import { useSession } from '@/hooks/useSession'
import { supabase, getProfile } from '@/lib/supabase'
import { statusMeta } from '@/lib/gamciv'
import GamCivMark from '@/components/GamCivMark'
import type { Complaint } from '@/lib/types'
import {
  getInstituteUser,
  officerAccept,
  officerReject,
  officerRequestInfo,
  officerSetStatus,
  officerAttachProof,
  officerForward,
  type InstituteUser,
} from '@/lib/institute'

const PAGE_SIZE = 50

const CATEGORY_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const OPEN_STATUSES = new Set([
  'submitted',
  'received',
  'assigned',
  'in_progress',
  'waiting_info',
  'forwarded',
  'citizen_confirmation',
  'escalated',
  'reopened',
])

/** UTC day key, e.g. "2026-10-19". */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    normal: 'bg-blue-100 text-blue-700 border-blue-200',
    low: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <Badge variant="outline" className={map[urgency] ?? 'bg-slate-100 text-slate-600 border-slate-200'}>
      {urgency || 'normal'}
    </Badge>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

export default function InstituteDashboard() {
  const { session, loading: sessionLoading } = useSession()
  const [staff, setStaff] = useState<InstituteUser | null>(null)
  const [roleChecked, setRoleChecked] = useState(false)
  const [rows, setRows] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [institutions, setInstitutions] = useState<
    Array<{ id: string; name: string; logo: string | null }>
  >([])
  const staffRef = useRef<InstituteUser | null>(null)
  const lastLoadedInstRef = useRef<string | null>(null)

  // Resolve "is this user institutional staff?" once per session: an officer
  // role plus an officers row links the account to an institution.
  useEffect(() => {
    if (sessionLoading) return
    const user = session?.user
    if (!user) {
      setRoleChecked(true)
      return
    }
    let cancelled = false
    ;(async () => {
      const profile = await getProfile(user.id)
      if (profile?.role === 'officer') {
        const inst = await getInstituteUser(user.id)
        if (!cancelled) {
          staffRef.current = inst
          setStaff(inst)
        }
      }
      if (!cancelled) setRoleChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [sessionLoading, session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Full load of the institution's complaint feed (newest first). */
  const loadFeed = useCallback(async (institutionId: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('complaints')
      .select(
        'id, tracking_no, title, description, urgency, status, created_at, updated_at, citizen_name, citizen_phone, resolution_photo_url, institution_id',
      )
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (error) {
      console.error('institute feed query failed:', error.message)
      setLoadFailed(true)
      setRows([])
    } else {
      setLoadFailed(false)
      setRows((data as unknown as Complaint[]) ?? [])
    }
    setLoading(false)
  }, [])

  // Load the feed once the staff user is known; realtime handles updates after.
  useEffect(() => {
    if (!staff?.institutionId) return
    if (lastLoadedInstRef.current === staff.institutionId) return
    lastLoadedInstRef.current = staff.institutionId
    loadFeed(staff.institutionId)
  }, [staff?.institutionId, loadFeed])

  // Realtime: new complaints appear live; status changes refresh in place.
  useEffect(() => {
    const institutionId = staff?.institutionId
    if (!institutionId) return
    const channel = supabase
      .channel(`institute-complaints-${institutionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'complaints',
          filter: `institution_id=eq.${institutionId}`,
        },
        (payload) => {
          const row = payload.new as Complaint
          setRows((current) => {
            if (current.some((c) => c.id === row.id)) return current
            return [row, ...current].slice(0, PAGE_SIZE)
          })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'complaints',
          filter: `institution_id=eq.${institutionId}`,
        },
        (payload) => {
          const row = payload.new as Complaint
          setRows((current) => {
            if (!current.some((c) => c.id === row.id)) return [row, ...current].slice(0, PAGE_SIZE)
            return current.map((c) => (c.id === row.id ? row : c))
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [staff?.institutionId])

  // Institutions (name + logo) for the header, row badges and forward targets.
  useEffect(() => {
    let alive = true
    supabase
      .from('institutions')
      .select('id, name, logo')
      .then(({ data }) => {
        if (alive && data) setInstitutions(data as Array<{ id: string; name: string; logo: string | null }>)
      })
    return () => {
      alive = false
    }
  }, [])

  const stats = useMemo(() => {
    const now = Date.now()
    const todayKey = dayKey(new Date().toISOString())
    const weekAgo = now - 7 * 86400000
    const today = rows.filter((c) => dayKey(c.created_at) === todayKey).length
    const open = rows.filter((c) => OPEN_STATUSES.has(c.status)).length
    const resolvedWeek = rows.filter(
      (c) => c.status === 'resolved' && new Date(c.updated_at ?? c.created_at).getTime() >= weekAgo,
    ).length
    const resolvedDurations = rows
      .filter((c) => c.status === 'resolved')
      .map((c) => new Date(c.updated_at ?? c.created_at).getTime() - new Date(c.created_at).getTime())
      .filter((ms) => ms > 0)
    const avgH =
      resolvedDurations.length > 0
        ? resolvedDurations.reduce((a, b) => a + b, 0) / resolvedDurations.length / 3600000
        : 0
    return { today, open, resolvedWeek, avgH }
  }, [rows])

  const categoryData = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000
    const counts = new Map<string, number>()
    for (const c of rows) {
      if (new Date(c.created_at).getTime() < weekAgo) continue
      counts.set(c.title, (counts.get(c.title) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count], i) => ({ label, count, fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))
  }, [rows])

  const trendData = useMemo(() => {
    const days: Array<{ day: string; label: string; count: number }> = []
    const counts = new Map<string, number>()
    for (const c of rows) counts.set(dayKey(c.created_at), (counts.get(dayKey(c.created_at)) ?? 0) + 1)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      const key = dayKey(d.toISOString())
      days.push({
        day: key,
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
        count: counts.get(key) ?? 0,
      })
    }
    return days
  }, [rows])

  const chartConfig = useMemo(() => {
    const cfg: ChartConfig = { count: { label: 'Complaints' } }
    for (const entry of categoryData) cfg[entry.label] = { label: entry.label, color: entry.fill }
    return cfg
  }, [categoryData])

  /** Run one action with busy state + a refresh fallback for realtime. */
  const runAction = useCallback(
    async (id: string, fn: () => Promise<boolean>) => {
      setBusyId(id)
      const ok = await fn()
      setBusyId(null)
      if (ok) {
        toast.success('Done')
        const inst = staffRef.current
        if (inst) void loadFeed(inst.institutionId)
      }
    },
    [loadFeed],
  )

  if (sessionLoading || !roleChecked) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-5 py-12 md:px-6" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-5 py-12 md:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Staff account not linked</CardTitle>
            <CardDescription>
              This profile has the officer role but no officers row yet. Ask an administrator to
              link your account to an institution.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Logo for the staff's own institution (header + row badges). Falls back to
  // the GamCiv mark when the institutions row has no logo URL.
  const ownLogo = institutions.find((i) => i.id === staff.institutionId)?.logo ?? null
  const logoById = (id: string | null): string | null => {
    if (!id) return ownLogo
    return institutions.find((i) => i.id === id)?.logo ?? ownLogo
  }

  const visible = rows.filter((c) => {
    if (!filter.trim()) return true
    const q = filter.trim().toLowerCase()
    return (
      c.title.toLowerCase().includes(q) ||
      c.tracking_no.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q)
    )
  })

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-6">
      <Card className="mb-6 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            {ownLogo ? (
              <img
                src={ownLogo}
                alt={`${staff.institutionName} logo`}
                className="h-12 w-12 rounded-lg bg-white object-contain p-1 ring-1 ring-border"
              />
            ) : (
              <GamCivMark />
            )}
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">{staff.institutionName}</h1>
              <p className="text-sm text-muted-foreground">Live complaints dashboard · updates in real time</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by title, tracking no, status"
              className="h-9 w-64"
              aria-label="Filter complaints"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh feed"
              onClick={() => void loadFeed(staff.institutionId)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Complaints today" value={stats.today} hint="Filed since midnight UTC" />
        <StatCard label="Open / in progress" value={stats.open} hint="Not yet resolved or closed" />
        <StatCard label="Resolved this week" value={stats.resolvedWeek} hint="Last 7 days" />
        <StatCard
          label="Avg resolution time"
          value={
            stats.avgH >= 1
              ? `${stats.avgH.toFixed(1)} h`
              : stats.avgH > 0
                ? `${Math.round(stats.avgH * 60)} min`
                : '—'
          }
          hint="Across resolved complaints"
        />
      </div>

      {/* ── Charts ──────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Complaints by category</CardTitle>
            <CardDescription>Last 7 days · top categories</CardDescription>
          </CardHeader>
          <CardContent>
            {categoryData.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No complaints in the last 7 days
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={categoryData} margin={{ left: -24, right: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tick={{ fontSize: 11 }}
                    interval={0}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={4} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Daily trend</CardTitle>
            <CardDescription>Complaints filed per day · last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ count: { label: 'Complaints' } }} className="h-48 w-full">
              <AreaChart data={trendData} margin={{ left: -24, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11 }}
                  interval={0}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="count"
                  type="monotone"
                  fill="var(--chart-2)"
                  fillOpacity={0.25}
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Live complaints feed ────────────────────────────────── */}
      <div className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
          Complaints feed
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            live
          </span>
        </h2>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : loadFailed ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Could not load complaints. Check your connection and try again.
              </p>
              <Button variant="outline" onClick={() => void loadFeed(staff.institutionId)}>
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </CardContent>
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No complaints{filter ? ' match your filter' : ' yet'}</p>
              <p className="text-xs text-muted-foreground">
                New reports for {staff.institutionName} will appear here in real time.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visible.map((c) => {
              const meta = statusMeta(c.status)
              const busy = busyId === c.id
              const open = OPEN_STATUSES.has(c.status)
              const rowLogo = logoById(c.institution_id)
              return (
                <Card key={c.id} className="shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-3">
                        {rowLogo ? (
                          <img
                            src={rowLogo}
                            alt=""
                            aria-hidden="true"
                            className="mt-0.5 h-8 w-8 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-border"
                          />
                        ) : (
                          <span className="mt-0.5 shrink-0" aria-hidden="true">
                            <GamCivMark />
                          </span>
                        )}
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">{c.title}</CardTitle>
                          <CardDescription className="truncate">
                            {c.tracking_no} · {timeAgo(c.created_at)}
                            {c.citizen_name ? ` · ${c.citizen_name}` : ''}
                            {c.citizen_phone ? ` · ${c.citizen_phone}` : ''}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <UrgencyBadge urgency={c.urgency} />
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-3">
                    <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2 border-t bg-muted/30 py-3">
                    {busy ? (
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Working…
                      </span>
                    ) : (
                      <>
                        {c.status === 'submitted' && (
                          <Button size="sm" onClick={() => void runAction(c.id, () => officerAccept(c.id))}>
                            Accept
                          </Button>
                        )}
                        {open && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void runAction(c.id, () => officerReject(c.id))}
                          >
                            Reject
                          </Button>
                        )}
                        {open && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void runAction(c.id, () => officerRequestInfo(c.id))}
                          >
                            Request info
                          </Button>
                        )}
                        {c.status === 'assigned' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void runAction(c.id, () =>
                                officerSetStatus(c.id, 'in_progress', { withNote: true }),
                              )
                            }
                          >
                            Start progress
                          </Button>
                        )}
                        {c.status === 'waiting_info' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void runAction(c.id, () =>
                                officerSetStatus(c.id, 'in_progress', { withNote: false }),
                              )
                            }
                          >
                            Resume
                          </Button>
                        )}
                        {c.status === 'in_progress' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void runAction(c.id, () =>
                                officerSetStatus(c.id, 'resolved', { withNote: true }),
                              )
                            }
                          >
                            Mark resolved
                          </Button>
                        )}
                        {c.status === 'resolved' && !c.resolution_photo_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void runAction(c.id, () => officerAttachProof(c.id))}
                          >
                            Attach proof
                          </Button>
                        )}
                        {open && c.status !== 'forwarded' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void runAction(c.id, () =>
                                officerForward(
                                  c.id,
                                  institutions
                                    .filter((i) => i.id !== staff.institutionId)
                                    .map((i) => ({ id: i.id, name: i.name })),
                                ),
                              )
                            }
                          >
                            Forward
                          </Button>
                        )}
                      </>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
