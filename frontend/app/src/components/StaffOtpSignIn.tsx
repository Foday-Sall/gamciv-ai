import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MailIcon } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, routeByRole } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/authErrors'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'

export function StaffOtpSignIn({ email }: { email: string }) {
  const [codeSent, setCodeSent] = useState(false)
  const [requestedEmail, setRequestedEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function sendCode() {
    setError(null)
    if (!email.trim() || !email.includes('@')) {
      setError('Enter your account email first.')
      return
    }
    setBusy(true)
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      })
      if (sendError) {
        setError(friendlyAuthError(sendError))
        return
      }
      setRequestedEmail(email.trim())
      setCode('')
      setCodeSent(true)
      toast.success('Sign-in code sent', { description: 'Check your email for the 6-digit code.' })
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setBusy(true)
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: requestedEmail,
        token: code.trim(),
        type: 'email',
      })
      if (verifyError) {
        setError(friendlyAuthError(verifyError))
        return
      }
      const role = await routeByRole()
      if (role === 'citizen') {
        navigate('/home', { replace: true })
      } else if (!role) {
        setError('This account is not enabled for GamFix access. Contact the platform administrator.')
      }
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <Button
        type="button"
        variant="link"
        className="mx-auto block h-auto px-0 text-sm font-medium"
        onClick={() => void sendCode()}
        disabled={busy}
      >
        {busy && !codeSent ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {codeSent ? 'Resend sign-in code' : 'Sign in with an email code'}
      </Button>
      {error && !codeSent && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}
      {codeSent && (
        <form onSubmit={verifyCode} className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
          <div>
            <h2 className="text-sm font-semibold">Check your email</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the 6-digit sign-in code sent to <span className="font-medium text-foreground">{requestedEmail}</span>.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sign-in-code">Sign-in code</Label>
            <InputGroup>
              <InputGroupAddon><MailIcon /></InputGroupAddon>
              <InputGroupInput
                id="sign-in-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                required
              />
            </InputGroup>
          </div>
          {error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}
          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Verify and sign in
          </Button>
          <Button
            type="button"
            variant="link"
            className="mx-auto block h-auto px-0 text-sm"
            onClick={() => { setCodeSent(false); setCode(''); setError(null) }}
            disabled={busy}
          >
            Use password instead
          </Button>
        </form>
      )}
    </div>
  )
}
