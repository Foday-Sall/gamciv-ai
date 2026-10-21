/**
 * /track - look up a report by tracking number and show its status timeline.
 * Data comes from the real `track_complaint` RPC (SECURITY DEFINER), which
 * works with or without an account; complaint rows themselves are not
 * anon-readable (RLS). Unknown numbers return null, which we show as "not
 * found". Network failures get their own message so a dead connection is not
 * mistaken for a bad tracking number.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2, Clock, CircleAlert, Search, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { handleAuthExpired, isAuthError, isNetworkError, supabase } from '@/lib/supabase'
import { statusMeta } from '@/lib/gamciv'
import { useSession } from '@/hooks/useSession'

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
  { key: 'assigned', label: 'Assigned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'citizen_confirmation', label: 'Fix reported' },
  { key: 'closed', label: 'Closed' },
]

const STATUS_STAGE: Record<string, number> = {
  submitted: 0,
  received: 1,
  assigned: 2,
  forwarded: 1,
  in_progress: 3,
  waiting_info: 3,
  escalated: 3,
  reopened: 2,
  citizen_confirmation: 4,
  resolved: 4,
  closed: 5,
}

export default function Track() {
  useEffect(() => {
    document.title = 'Track a report · GamFix'
  }, [])
  const [params, setParams] = useSearchParams()
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TrackResult | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [searched, setSearched] = useState(false)
  const [refreshingStatus, setRefreshingStatus] = useState(false)
  const [canConfirm, setCanConfirm] = useState(false)
  const [citizenAction, setCitizenAction] = useState<'confirm' | 'reopen' | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [citizenActionError, setCitizenActionError] = useState<string | null>(null)
  const { session } = useSession()

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
    setResult(null)
    setSearched(false)
    setCanConfirm(false)
    setCitizenActionError(null)
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
          toast.error('Network problem. Check your connection and try again.')
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
      toast.error('Network problem. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const refreshStatus = useCallback(async (ref: string, quiet = false) => {
    if (!navigator.onLine) {
      if (!quiet) toast.error("You're offline. Reconnect and try again.")
      return
    }
    setRefreshingStatus(true)
    try {
      const { data, error } = await supabase.rpc('track_complaint', { p_tracking_no: ref })
      if (error) {
        if (isAuthError(error)) {
          if (!quiet) toast.error('Your session has expired. Please sign in again.')
          await handleAuthExpired()
          return
        }
        if (!quiet) toast.error('Could not refresh this report. Check your connection and try again.')
        return
      }
      if (data) setResult(data as unknown as TrackResult)
    } catch {
      if (!quiet) toast.error('Could not refresh this report. Check your connection and try again.')
    } finally {
      setRefreshingStatus(false)
    }
  }, [])

  useEffect(() => {
    const trackingNo = result?.tracking_no
    if (!trackingNo) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshStatus(trackingNo, true)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [result?.tracking_no, refreshStatus])

  useEffect(() => {
    let active = true
    setCanConfirm(false)
    setCitizenActionError(null)
    if (!session?.user.id || !result?.tracking_no || !['citizen_confirmation', 'resolved'].includes(result.status ?? '')) {
      return () => { active = false }
    }
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('fn_can_confirm_report', { p_tracking_no: result.tracking_no })
        if (active) setCanConfirm(!error && data === true)
      } catch {
        if (active) setCanConfirm(false)
      }
    })()
    return () => { active = false }
  }, [session?.user.id, result?.tracking_no, result?.status])

  async function respondToFix(action: 'confirm' | 'reopen') {
    if (!result || citizenAction) return
    if (action === 'reopen' && reopenReason.trim().length < 5) {
      setCitizenActionError('Please explain what still needs attention (at least 5 characters).')
      return
    }
    setCitizenAction(action)
    setCitizenActionError(null)
    try {
      const { data, error } = action === 'confirm'
        ? await supabase.rpc('confirm_complaint', { p_tracking_no: result.tracking_no, p_phone: null })
        : await supabase.rpc('reopen_complaint', {
            p_tracking_no: result.tracking_no,
            p_reason: reopenReason.trim(),
            p_phone: null,
          })
      if (error || data !== true) {
        setCitizenActionError(action === 'confirm'
          ? 'We could not close this report. Refresh and try again, or contact the handling service.'
          : 'We could not reopen this report. Refresh and try again, or contact the handling service.')
        return
      }
      setReopenReason('')
      toast.success(action === 'confirm' ? 'Thank you. This report is now closed.' : 'The report has been reopened.')
      await refreshStatus(result.tracking_no, true)
    } catch {
      setCitizenActionError('We could not update this report. Check your connection and try again.')
    } finally {
      setCitizenAction(null)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void runLookup()
  }

  const badge = result ? statusMeta(result.status ?? undefined) : null
  const currentIdx = result ? (STATUS_STAGE[result.status ?? ''] ?? -1) : -1

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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: STATUS_STEPS.length }).map((_, i) => (
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
                  Check for typos. The format is GMC-XXXX-XXXXX, copied from your report
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
                <div className="flex items-center gap-2">
                  {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshStatus(result.tracking_no)}
                    disabled={refreshingStatus}
                    aria-label="Refresh report status"
                  >
                    {refreshingStatus ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                    <span className="sr-only">Refresh status</span>
                  </Button>
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Handled by</dt>
                  <dd className="font-medium">{result.institution ?? 'Not provided'}</dd>
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
            <section aria-label="Report progress, six stages">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Progress</p>
                <p className="text-xs text-muted-foreground">
                  {currentIdx >= 0 ? `Step ${currentIdx + 1} of ${STATUS_STEPS.length} · ` : ''}{badge?.label ?? 'Status unavailable'}
                </p>
              </div>
              <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {STATUS_STEPS.map((s, i) => {
                  const done = currentIdx >= i && currentIdx !== -1
                  const isCurrent = currentIdx === i
                  return (
                    <li
                      key={s.key}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={
                        'flex min-h-[72px] items-center gap-3 rounded-lg border p-3 text-left ' +
                        (isCurrent
                          ? 'border-primary bg-primary/5 text-foreground'
                          : done
                            ? 'border-primary/30 bg-card text-foreground'
                            : 'border-border bg-card text-muted-foreground')
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ' +
                          (isCurrent
                            ? 'border-primary bg-primary text-primary-foreground'
                            : done
                              ? 'border-primary/40 bg-primary/5 text-primary'
                              : 'border-border')
                        }
                      >
                        {done && !isCurrent ? <CheckCircle2 className="h-4 w-4" /> : isCurrent ? <span className="h-2.5 w-2.5 rounded-full bg-current" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {isCurrent ? 'Current stage' : done ? 'Completed' : 'Upcoming'}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>

            {['citizen_confirmation', 'resolved'].includes(result.status ?? '') && (
              <section className="rounded-xl border border-primary/25 bg-primary/5 p-4" aria-labelledby="citizen-response-heading">
                <h3 id="citizen-response-heading" className="text-sm font-semibold">Your response is needed</h3>
                {canConfirm ? (
                  <>
                    <p className="mt-1 text-sm text-muted-foreground">The service says the fix is complete. Confirm it to close this report, or reopen it if the problem remains.</p>
                    <Button
                      type="button"
                      className="mt-4"
                      onClick={() => void respondToFix('confirm')}
                      disabled={citizenAction !== null}
                    >
                      {citizenAction === 'confirm' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                      Confirm fix and close report
                    </Button>
                    <div className="mt-4 space-y-2">
                      <Label htmlFor="reopen-reason">If it is not fixed, explain what still needs attention</Label>
                      <textarea
                        id="reopen-reason"
                        value={reopenReason}
                        onChange={(event) => setReopenReason(event.target.value)}
                        rows={3}
                        maxLength={1000}
                        placeholder="Describe what remains unresolved"
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void respondToFix('reopen')}
                        disabled={citizenAction !== null || reopenReason.trim().length < 5}
                      >
                        {citizenAction === 'reopen' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleAlert className="mr-2 h-4 w-4" aria-hidden="true" />}
                        Reopen report
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {session ? 'Only the citizen who filed this report can confirm the fix or reopen it.' : 'Sign in with the citizen account that filed this report to confirm the fix or reopen it.'}
                  </p>
                )}
                {citizenActionError && <p className="mt-3 text-sm text-destructive" role="alert">{citizenActionError}</p>}
              </section>
            )}

            {/* timeline */}
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Updates</p>
                <p className="text-xs text-muted-foreground">Refreshes automatically while this page is open</p>
              </div>
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
                        <p className="text-sm font-medium">{t.status ? statusMeta(t.status).label : 'Update'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t.at
                            ? new Date(t.at).toLocaleString('en-GB', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : ''}
                        </p>
                        {t.message && <p className="mt-1 text-sm text-muted-foreground">{t.message}</p>}
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
