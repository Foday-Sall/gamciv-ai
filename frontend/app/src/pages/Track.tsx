/**
 * /track — look up a report by tracking number and show its status timeline.
 * Data comes from the real `track_complaint` RPC (SECURITY DEFINER), which
 * works with or without an account; complaint rows themselves are not
 * anon-readable (RLS). Unknown numbers return null, which we show as "not
 * found". Network failures get their own message so a dead connection is not
 * mistaken for a bad tracking number.
 */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2, Clock, CircleAlert, Search, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { handleAuthExpired, isAuthError, isNetworkError, supabase } from '@/lib/supabase'
import { statusMeta } from '@/lib/gamciv'

type TimelineItem = { status: string | null; message: string | null; at: string }

type TrackResult = {
  tracking_no: string
  status: string | null
  urgency: string | null
  title: string | null
  description: string | null
  institution: string | null
  department: string | null
  expected_response_at: string | null
  resolved_at: string | null
  closed_at: string | null
  timeline: TimelineItem[]
}

const STATUS_STEPS: Array<{ key: string; label: string }> = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'received', label: 'Received' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
]

export default function Track() {
  useEffect(() => {
    document.title = 'Track a report · GamCiv'
  }, [])
  const [params, setParams] = useSearchParams()
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TrackResult | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [searched, setSearched] = useState(false)

  // Pre-fill from ?ref= (the wizard's success screen links here)
  useEffect(() => {
    const ref = params.get('ref')
    if (ref && !searched) {
      setValue(ref)
      void runLookup(ref)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  async function runLookup(ref?: string) {
    const raw = (ref ?? value).trim()
    if (!raw) return
    if (!navigator.onLine) {
      toast.error("You're offline. Reconnect and try again.")
      return
    }
    setLoading(true)
    setNotFound(false)
    try {
      const { data, error } = await supabase.rpc('track_complaint', {
        p_tracking_no: raw,
      })
      if (error) {
        console.error('track_complaint failed:', error.message)
        if (isAuthError(error)) {
          // Expired session: clear it so the next navigation asks for login.
          toast.error('Your session has expired. Please sign in again.')
          await handleAuthExpired()
          return
        }
        if (isNetworkError(error)) {
          toast.error('Network problem — check your connection and try again.')
        } else {
          setNotFound(true)
        }
        return
      }
      if (!data) {
        setNotFound(true)
        setResult(null)
        return
      }
      setResult(data as unknown as TrackResult)
      setSearched(true)
      setParams({ ref: raw }, { replace: true })
    } catch (err) {
      console.error('track threw:', err)
      toast.error('Network problem — check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void runLookup()
  }

  const badge = result ? statusMeta(result.status ?? undefined) : null
  const currentIdx = result
    ? STATUS_STEPS.findIndex((s) => s.key === result.status)
    : -1

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-6">
      <main className="w-full">
        <div className="grid grid-cols-1 gap-8 min-[1024px]:grid-cols-12">
        {/* Left: lookup (sticky on desktop) */}
        <div className="min-[1024px]:col-span-5">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Track a report</h1>
          <p className="mt-2 text-muted-foreground">
            Enter the tracking number you received when you filed your report.
          </p>

          <div className="mt-6 rounded-xl border border-border bg-card p-4 min-[1024px]:sticky min-[1024px]:top-24">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-2">
                <Label htmlFor="tracking" className="sr-only">Tracking number</Label>
                <Input
                  id="tracking"
                  value={value}
                  onChange={(e) => setValue(e.target.value.toUpperCase())}
                  placeholder="GMC-XXXX-XXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
              <Button type="submit" disabled={loading || !value.trim()}>
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                {loading ? 'Looking…' : 'Track'}
              </Button>
            </form>
          </div>

          <div className="mt-4 rounded-xl bg-secondary p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Where do I find my number?</p>
            <p className="mt-1">
              Every report confirmation shows a code like{' '}
              <span className="rounded bg-background px-1.5 py-0.5 font-mono text-foreground">GMC-2026-00042</span>{' '}
              right after you send it. Copy it there.
            </p>
          </div>
        </div>

        {/* Right: result */}
        <div className="min-[1024px]:col-span-7">
        {/* Empty state: nothing searched yet */}
        {!searched && !loading && !notFound && !result && (
          <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">Enter a tracking number to see its status</p>
          </div>
        )}

        {loading && !result && (
          <div className="mt-8 space-y-4" aria-live="polite" aria-busy="true">
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-6 w-3/4 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-6 w-20 shrink-0 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-muted" />
              ))}
            </div>
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
              <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
            </div>
          </div>
        )}

        {notFound && (
          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <p className="font-medium">No report found for that number</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check for typos — the format is GMC-XXXX-XXXXX, copied from your report
                  confirmation. Or start a{' '}
                  <Link to="/report" className="font-medium text-primary underline">new report</Link>.
                </p>
              </div>
            </div>
          </div>
        )}

        {result && (
          <section className="mt-8 space-y-6">
            {/* summary card */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-muted-foreground">{result.tracking_no}</p>
                  <h2 className="mt-1 font-display text-lg font-bold leading-tight">
                    {result.title ?? 'Report details withheld'}
                  </h2>
                </div>
                {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Handled by</dt>
                  <dd className="font-medium">{result.institution ?? '—'}</dd>
                </div>
                {result.department && (
                  <div>
                    <dt className="text-muted-foreground">Department</dt>
                    <dd className="font-medium">{result.department}</dd>
                  </div>
                )}
                {result.expected_response_at && (
                  <div>
                    <dt className="text-muted-foreground">Expected response</dt>
                    <dd className="font-medium">
                      {new Date(result.expected_response_at).toLocaleString('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* progress steps */}
            <div>
              <p className="mb-3 text-sm font-medium">Progress</p>
              <ol className="grid grid-cols-4 gap-2">
                {STATUS_STEPS.map((s, i) => {
                  const done = currentIdx >= i && currentIdx !== -1
                  const isCurrent = currentIdx === i
                  return (
                    <li
                      key={s.key}
                      className={
                        'rounded-lg border p-3 text-center text-xs ' +
                        (isCurrent
                          ? 'border-primary bg-primary/5'
                          : done
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border bg-card text-muted-foreground')
                      }
                    >
                      <span
                        className={
                          'mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full border ' +
                          (isCurrent
                            ? 'border-primary bg-primary text-primary-foreground'
                            : done
                              ? 'border-primary/60 bg-primary/10 text-primary'
                              : 'border-border')
                        }
                      >
                        {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                      </span>
                      {s.label}
                    </li>
                  )
                })}
              </ol>
            </div>

            {/* timeline */}
            <div>
              <p className="mb-3 text-sm font-medium">Updates</p>
              {result.timeline.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
                  <Clock className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium">No updates yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Updates appear here as soon as the handling service processes your
                    report. Check back later.
                  </p>
                </div>
              ) : (
                <ol className="space-y-3">
                  {result.timeline.map((t, i) => (
                    <li key={i} className="flex gap-3 rounded-lg border border-border bg-card p-4">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {t.at
                            ? new Date(t.at).toLocaleString('en-GB', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : ''}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{t.message ?? ''}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        )}
        </div>
        </div>
      </main>
    </div>
  )
}
