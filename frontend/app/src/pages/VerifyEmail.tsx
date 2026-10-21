/**
 * VerifyEmail — 6-digit email confirmation screen.
 *
 * The server signs confirmation links, but devices that open the app without
 * that session can verify with the one-time code instead. Signed-in users who
 * still show `email_confirmed_at === null` are routed here after login rather
 * than seeing home content.
 */
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/authErrors'

const OTP_LENGTH = 6

export default function VerifyEmail() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(60)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    document.title = 'Verify email · GamFix'
  }, [])

  // Pre-fill: first from the signup/login hand-off (location state), then
  // from the session for signed-in users who still need confirmation.
  useEffect(() => {
    const stateEmail = (location.state as { email?: string } | null)?.email
    if (stateEmail) {
      setEmail(stateEmail)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      const mail = data.session?.user?.email
      if (mail) setEmail(mail)
    })
  }, [location.state])

  // 60s resend cooldown.
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  async function resendCode() {
    setError(null)
    setBusy(true)
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    })
    setBusy(false)
    if (err) {
      if (err.message.toLowerCase().includes('already confirmed')) {
        // Already verified: let the user continue to sign in.
        navigate('/login', { replace: true })
        return
      }
      setError(friendlyAuthError(err))
      return
    }
    setResent(true)
    setResendIn(60)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (token.trim().length !== OTP_LENGTH) {
      setError('Enter the ' + OTP_LENGTH + '-digit code from your email.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) {
      setError(friendlyAuthError(error))
      return
    }
    // Email verified. Next step: verify the phone with the WhatsApp code.
    navigate('/verify/phone', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="items-center text-center">
          <MailCheck className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <CardTitle className="font-display text-xl font-bold">Verify your email</CardTitle>
          <CardDescription>
            Enter the {OTP_LENGTH}-digit code we sent to {email || 'your email'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="verify-email">Email</Label>
              <Input
                id="verify-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="verify-token">6-digit code</Label>
              <Input
                id="verify-token"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                placeholder="······"
                className="text-center font-mono text-lg tracking-[0.5em]"
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Verifying…' : 'Verify email'}
            </Button>
            <button
              type="button"
              onClick={resendCode}
              disabled={busy || resendIn > 0}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {resendIn > 0 ? `Resend code available in ${resendIn}s` : 'Resend code'}
            </button>
            {resent ? (
              <p className="text-center text-xs text-muted-foreground">A new code was sent.</p>
            ) : null}
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Wrong address?{' '}
            <Link to="/signup" className="text-primary underline underline-offset-2">
              Sign up again
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
