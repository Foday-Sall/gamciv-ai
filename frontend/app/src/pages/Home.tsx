/**
 * /home — signed-in landing. Per redesign spec §3a/§3a':
 *  - Greeting + one primary CTA card (Report a problem), quick-track row.
 *  - "Your reports" list (recent, from RLS query) with skeletons.
 *  - Desktop (≥1024px): 8/4 grid — left content, right "How GamCiv works"
 *    and Emergencies cards. No header here: AppShell owns navigation.
 */
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Camera,
  ChevronRight,
  FileText,
  MapPin,
  PhoneCall,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession, useDisplayName } from '@/hooks/useSession'
import { supabase } from '@/lib/supabase'
import { statusMeta } from '@/lib/gamciv'

type RecentRow = {
  tracking_no: string
  title: string | null
  status: string | null
  created_at: string
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Home() {
  const { session, loading } = useSession()
  const name = useDisplayName(session)
  const [recent, setRecent] = useState<RecentRow[] | null>(null)

  useEffect(() => {
    document.title = 'Home · GamCiv'
  }, [])

  useEffect(() => {
    if (!session) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('complaints')
        .select('tracking_no, title, status, created_at')
        .order('created_at', { ascending: false })
        .limit(3)
      if (!alive) return
      setRecent((data as unknown as RecentRow[]) ?? [])
    })()
    return () => {
      alive = false
    }
  }, [session])

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-5 py-12 md:px-6">
        <div className="mx-auto w-full max-w-2xl min-[1024px]:mx-0" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-3 h-5 w-72" />
          <Skeleton className="mt-6 h-28 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  const firstName = name ? name.split(' ')[0] : ''

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-6">
      <div className="grid grid-cols-1 gap-8 min-[1024px]:grid-cols-12">
        {/* ── Left / main column (full width on mobile) ─────────── */}
        <div className="min-[1024px]:col-span-8">
          <h1 className="font-display text-2xl font-bold tracking-tight min-[1024px]:text-4xl">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-muted-foreground">What needs fixing today?</p>

          {/* Primary CTA card */}
          <Link
            to="/report"
            className="mt-6 flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Report a problem</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                A photo, a sentence and a location — we route it to the right service.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>

          {/* Quick track row */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              to="/track"
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
              </span>
              <span className="font-semibold">Track a report</span>
            </Link>
            <Link
              to="/my-reports"
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
              </span>
              <span className="font-semibold">My reports</span>
            </Link>
          </div>

          {/* Your reports */}
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold tracking-tight">
                Your reports
              </h2>
              <Link
                to="/my-reports"
                className="text-sm font-medium text-primary hover:underline"
              >
                See all
              </Link>
            </div>

            {recent === null ? (
              <div className="mt-3 space-y-3" aria-busy="true" aria-live="polite">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-border bg-card p-6 text-center">
                <p className="text-sm font-medium">No reports yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your filed reports and their status will appear here.
                </p>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {recent.map((r) => {
                  const badge = statusMeta(r.status ?? undefined)
                  return (
                    <li key={r.tracking_no}>
                      <Link
                        to={`/track?ref=${r.tracking_no}`}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            <span className="truncate font-medium leading-tight">
                              {r.title ?? 'Report'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <span className="font-mono">{r.tracking_no}</span>
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right column (desktop only) ───────────────────────── */}
        <aside className="min-[1024px]:col-span-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-bold tracking-tight">
              How GamCiv works
            </h2>
            <ol className="mt-4 space-y-4">
              {[
                ['Report', 'Describe the problem, add a photo and a location.'],
                ['Track', 'Get a tracking number and follow every update.'],
                ['Resolved', 'Watch the service fix it and confirm the result.'],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl bg-secondary p-5">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-foreground" aria-hidden="true" />
              <h2 className="font-display text-base font-bold tracking-tight">
                Emergencies
              </h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              For fires, crime or a life-threatening emergency, call{' '}
              <span className="font-bold text-foreground tabular">117</span> first. Report
              it here afterwards so it is on record.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
