/**
 * /profile — the signed-in user's account page. Per spec §3d:
 * mobile: centered max-w-md card stack; desktop: 7/5 two-column grid.
 * Navigation lives in AppShell. Sign out uses SignOutDialog (destructive).
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LogOut, Mail, ShieldCheck, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useSession, useDisplayName } from '@/hooks/useSession'
import { supabase } from '@/lib/supabase'
import { SignOutDialog } from '@/components/ConfirmDialogs'

export const APP_VERSION = '1.1.0'

export default function Profile() {
  const { session, loading } = useSession()
  const name = useDisplayName(session)
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    document.title = 'Your profile · GamCiv'
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading…
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  const user = session.user
  const meta = user.user_metadata ?? {}
  const displayName =
    name ||
    (meta.full_name as string) ||
    (meta.name as string) ||
    user.email ||
    'Your account'
  const email = user.email
  const createdAt = user.created_at ? new Date(user.created_at) : null

  async function signOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    setSigningOut(false)
    setConfirmOpen(false)
    if (error) {
      toast.error('Could not sign out. Try again.')
      return
    }
    toast.success('Signed out')
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-6">
      <div className="mx-auto w-full max-w-md min-[1024px]:mx-0 min-[1024px]:max-w-none">
        <h1 className="font-display text-2xl font-bold tracking-tight">Your profile</h1>
        <p className="mt-2 text-muted-foreground">Your account details for reporting.</p>

        <div className="mt-6 grid grid-cols-1 gap-4 min-[1024px]:grid-cols-12">
          {/* Account card (col 7 on desktop) */}
          <div className="rounded-xl border border-border bg-card p-5 min-[1024px]:col-span-7">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
                <User className="h-7 w-7 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold leading-tight">
                  {displayName}
                </p>
                {email && displayName !== email && (
                  <p className="truncate text-sm text-muted-foreground">{email}</p>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t border-border/60 pt-4 text-sm">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">Email</span>
                <span className="ml-auto truncate font-medium" title={email ?? undefined}>
                  {email ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">Member since</span>
                <span className="ml-auto font-medium">
                  {createdAt
                    ? createdAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Session + version (col 5 on desktop) */}
          <div className="space-y-4 min-[1024px]:col-span-5">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm font-medium">Session</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Signing out keeps your submitted reports — you can still follow them with
                their tracking numbers.
              </p>
              <Button
                variant="outline"
                className="mt-4 h-11 w-full"
                onClick={() => setConfirmOpen(true)}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                GamCiv web app · version {APP_VERSION}
              </p>
              <Badge variant="outline" className="border-border text-muted-foreground">
                Beta
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <SignOutDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={signOut}
        busy={signingOut}
      />
    </div>
  )
}
