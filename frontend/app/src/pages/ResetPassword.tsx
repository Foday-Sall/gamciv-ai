import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, KeyRound, Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import GamCivMark from '@/components/GamCivMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { friendlyAuthError } from '@/lib/authErrors'
import { supabase } from '@/lib/supabase'
import { PASSWORD_RECOVERY_EMAIL_KEY, PASSWORD_RECOVERY_STEP_KEY } from './ForgotPassword'

const GENERIC_NOTICE =
  'If an account exists for this email, we sent a 6-digit reset code. Check your inbox and spam folder. The code expires in 15 minutes.'

type RouteState = { email?: string; codeSent?: boolean } | null
type RecoveryStep = 'code' | 'password'

function readStoredEmail() {
  try {
    return sessionStorage.getItem(PASSWORD_RECOVERY_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

function readStoredStep(): RecoveryStep {
  try {
    return sessionStorage.getItem(PASSWORD_RECOVERY_STEP_KEY) === 'password'
      ? 'password'
      : 'code'
  } catch {
    return 'code'
  }
}

export default function ResetPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeState = location.state as RouteState
  const email = routeState?.email ?? readStoredEmail()
  const [step, setStep] = useState<RecoveryStep>(readStoredStep)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(routeState?.codeSent ? 60 : 0)

  useEffect(() => {
    if (!email) {
      navigate('/forgot-password', { replace: true })
    }
  }, [email, navigate])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  useEffect(() => {
    if (step !== 'password') return
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && !data.session) {
        setStep('code')
        try {
          sessionStorage.removeItem(PASSWORD_RECOVERY_STEP_KEY)
        } catch {
          // Keep the code step if session storage is unavailable.
        }
      }
    }).catch(() => {
      if (!cancelled) setStep('code')
    })
    return () => {
      cancelled = true
    }
  }, [step])

  async function resendCode() {
    if (resendIn > 0 || busy) return
    setError(null)
    setBusy(true)
    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/app/`,
      })
      if (requestError) {
        setError(friendlyAuthError(requestError))
        return
      }
      setCode('')
      setResendIn(60)
    } catch (requestFailure) {
      setError(friendlyAuthError(requestFailure))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.')
      return
    }

    setBusy(true)
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'recovery',
      })
      if (verifyError) {
        setError(friendlyAuthError(verifyError))
        return
      }
      try {
        sessionStorage.setItem(PASSWORD_RECOVERY_STEP_KEY, 'password')
      } catch {
        // The verified session still allows password update for this page view.
      }
      setStep('password')
    } catch (verificationFailure) {
      setError(friendlyAuthError(verificationFailure))
    } finally {
      setBusy(false)
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Your new password needs at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Those passwords do not match. Check them and try again.')
      return
    }

    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(friendlyAuthError(updateError))
        return
      }

      await supabase.auth.signOut({ scope: 'local' })
      try {
        sessionStorage.removeItem(PASSWORD_RECOVERY_EMAIL_KEY)
        sessionStorage.removeItem(PASSWORD_RECOVERY_STEP_KEY)
      } catch {
        // Reset state is cleared on this tab when browser storage is available.
      }
      toast.success('Password updated', {
        description: 'You can now sign in with your new password.',
      })
      navigate('/login', { replace: true })
    } catch (updateFailure) {
      setError(friendlyAuthError(updateFailure))
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
            {step === 'code' ? 'Check your email' : 'Choose a new password'}
          </h1>
          <CardDescription className="max-w-sm">
            {step === 'code'
              ? `Enter the one-time code sent to ${email || 'your email address'}.`
              : 'Your code is confirmed. Choose a new password for your GamCiv account.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'code' ? (
            <form onSubmit={verifyCode} className="space-y-4">
              <div role="status" className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm text-primary">
                {GENERIC_NOTICE}
              </div>
              <div className="space-y-2">
                <Label htmlFor="recovery-code">6-digit code</Label>
                <Input
                  id="recovery-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  placeholder="······"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                />
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={busy} className="h-11 w-full text-base">
                {busy ? <Loader2 className="animate-spin" /> : <MailCheck />}
                {busy ? 'Checking code…' : 'Verify code'}
              </Button>
              <div className="space-y-2 text-center">
                <p className="text-xs text-muted-foreground">Didn’t get the email? Check your spam folder.</p>
                <Button type="button" variant="link" disabled={busy || resendIn > 0} onClick={resendCode} className="h-auto">
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate('/forgot-password', { state: { email } })}
                className="w-full"
              >
                <KeyRound /> Use a different email
              </Button>
            </form>
          ) : (
            <form onSubmit={updatePassword} className="space-y-4">
              <div role="status" className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm text-primary">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Code confirmed. Your new password must be at least 6 characters.</span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={busy} className="h-11 w-full text-base">
                {busy ? <Loader2 className="animate-spin" /> : null}
                {busy ? 'Updating password…' : 'Update password'}
              </Button>
            </form>
          )}
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
