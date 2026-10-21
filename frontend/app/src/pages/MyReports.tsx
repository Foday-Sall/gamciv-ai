/**
 * /my-reports — the signed-in user's submitted reports.
 * Queries complaints by RLS (citizen_id = auth.uid()), newest first.
 * Each row: status badge, title, tracking number, date → opens the tracker.
 * Per spec §2a: falls back to locally stored tracking numbers if the query fails.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { supabase } from '@/lib/supabase'
import { statusMeta } from '@/lib/gamciv'
import { useSession } from '@/hooks/useSession'

type Row = {
  tracking_no: string
  title: string | null
  status: string | null
  created_at: string
}

const LOCAL_KEY = 'gamciv_recent_tracking'

export function rememberTracking(no: string) {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    const list: string[] = raw ? JSON.parse(raw) : []
    const next = [no, ...list.filter((x) => x !== no)].slice(0, 10)
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable — non-critical */
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function MyReports() {
  const { session, loading: sessionLoading } = useSession()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [localRefs, setLocalRefs] = useState<string[]>([])

  useEffect(() => {
    document.title = 'My reports · GamFix'
  }, [])

  useEffect(() => {
    if (sessionLoading) return
    if (!session) return
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('complaints')
        .select('tracking_no, title, status, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (!alive) return
      if (error) {
        console.error('my reports query failed:', error.message)
        setLoadFailed(true)
        setRows([])
      } else {
        setRows((data as unknown as Row[]) ?? [])
      }
      try {
        const raw = localStorage.getItem(LOCAL_KEY)
        if (raw) setLocalRefs(JSON.parse(raw))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      alive = false
    }
  }, [session, sessionLoading])

  const localOnly = localRefs.filter(
    (ref) => !rows?.some((r) => r.tracking_no === ref),
  )

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          My reports
        </h1>
        <p className="mt-2 text-muted-foreground">
          Every report you have filed, with its current status.
        </p>

        {/* Loading skeletons */}
        {rows === null && !sessionLoading && (
          <div className="mt-6 space-y-3" aria-busy="true" aria-live="polite">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {rows !== null && rows.length === 0 && localOnly.length === 0 && (
          <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 font-semibold">You haven't filed a report yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              See something that needs fixing? Report it and follow it until it's fixed.
            </p>
            <Button className="mt-4" onClick={() => navigate('/report')}>
              <Plus />
              Report a problem
            </Button>
          </div>
        )}

        {/* Load-failure note */}
        {loadFailed && localOnly.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Couldn't load your report list — showing tracking numbers from this device.
          </p>
        )}

        {/* Rows */}
        {rows !== null && rows.length > 0 && (
          <ul className="mt-6 space-y-3">
            {rows.map((r) => {
              const badge = statusMeta(r.status ?? undefined)
              return (
                <li key={r.tracking_no}>
                  <Link
                    to={`/track?ref=${r.tracking_no}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <span className="truncate font-semibold leading-tight">
                          {r.title ?? 'Report'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{r.tracking_no}</span>
                        {' · '}
                        {formatDate(r.created_at)}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        {/* Local fallback refs (when not already listed) */}
        {rows !== null && localOnly.length > 0 && (
          <>
            <p className="mt-8 text-sm font-medium">Tracked on this device</p>
            <ul className="mt-3 space-y-3">
              {localOnly.map((ref) => (
                <li key={ref}>
                  <Link
                    to={`/track?ref=${ref}`}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:shadow-sm"
                  >
                    <span className="font-mono text-sm">{ref}</span>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
