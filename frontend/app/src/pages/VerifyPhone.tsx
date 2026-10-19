/**
 * VerifyPhone — phone number entry + 6-digit SMS code.
 *
 * Delivery goes through the project's Supabase instance: `signInWithOtp`
 * sends the SMS, then `verifyOtp` with `type: 'sms'` confirms it. This path
 * is also the fallback when a user's email is unconfirmed but they can prove
 * possession of the phone recorded on their profile.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase, isNetworkError } from '@/lib/supabase'

const OTP_LENGTH = 6

/** Light normalization for Gambian numbers: keep digits and a leading +. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? digits : `+${digits.replace(/^\+*/, '')}`
}

export default function VerifyPhone() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [token, setToken] = useState('')
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Verify phone · GamCiv'
  }, [])

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const normalized = normalizePhone(phone)
    if (normalized.replace(/\D/g, '').length < 7) {
      setError('Enter a valid phone number including the country code.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: normalized })
    setBusy(false)
    if (error) {
      setError(isNetworkError(error) ? 'Check your connection and try again.' : error.message)
      return
    }
    setStage('code')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (token.trim().length !== OTP_LENGTH) {
      setError('Enter the ' + OTP_LENGTH + '-digit code from the SMS.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({
      phone: normalizePhone(phone),
      token: token.trim(),
      type: 'sms',
    })
    setBusy(false)
    if (error) {
      setError(isNetworkError(error) ? 'Check your connection and try again.' : error.message)
      return
    }
    navigate('/home', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="items-center text-center">
          <Smartphone className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <CardTitle className="font-display text-xl font-bold">Verify your phone</CardTitle>
          <CardDescription>
            {stage === 'phone'
              ? 'We will text you a one-time code to confirm this number.'
              : `Enter the ${OTP_LENGTH}-digit code sent to ${normalizePhone(phone)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stage === 'phone' ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verify-phone">Phone number</Label>
                <Input
                  id="verify-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+220 7 000 000"
                  required
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verify-sms-code">6-digit SMS code</Label>
                <Input
                  id="verify-sms-code"
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
                {busy ? 'Verifying…' : 'Verify phone'}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-2"
                onClick={() => {
                  setStage('phone')
                  setToken('')
                  setError(null)
                }}
              >
                Use a different number
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
