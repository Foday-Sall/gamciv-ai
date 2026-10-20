import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, Mail } from 'lucide-react'
import GamCivMark from '@/components/GamCivMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { friendlyAuthError } from '@/lib/authErrors'
import { supabase } from '@/lib/supabase'

export const PASSWORD_RECOVERY_EMAIL_KEY = 'gamciv:password-recovery-email'
export const PASSWORD_RECOVERY_STEP_KEY = 'gamciv:password-recovery-step'

type RouteState = { email?: string } | null

export default function ForgotPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeEmail = (location.state as RouteState)?.email ?? ''
  const [email, setEmail] = useState(routeEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const address = email.trim().toLowerCase()
    if (!address) {
      setError('Enter the email address for your GamCiv account.')
      return
    }

    setBusy(true)
    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/app/`,
      })
      if (requestError) {
        setError(friendlyAuthError(requestError))
        return
      }

      try {
        sessionStorage.setItem(PASSWORD_RECOVERY_EMAIL_KEY, address)
        sessionStorage.removeItem(PASSWORD_RECOVERY_STEP_KEY)
      } catch {
        // Route state still carries the address if browser storage is unavailable.
      }
      navigate('/reset-password', {
        replace: true,
        state: { email: address, codeSent: true },
      })
    } catch (requestFailure) {
      setError(friendlyAuthError(requestFailure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="items-center text-center">
          <GamCivMark className="h-12 w-12 rounded-xl shadow-sm" />
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Forgot your password?
          </h1>
          <CardDescription className="max-w-sm">
            Enter the email address for your account. We’ll send a one-time reset code if an account exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="recovery-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy} className="h-11 w-full text-base">
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? 'Sending code…' : 'Send reset code'}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Button asChild variant="link" className="h-auto px-0">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
