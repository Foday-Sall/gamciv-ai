/**
 * VerifyPhone — phone number entry + 6-digit WhatsApp code.
 *
 * Two steps:
 *  1. The user enters their phone number. We call the auth-verify edge
 *     function (POST /functions/v1/auth-verify/send-phone-otp) with the
 *     session JWT; it generates a hashed code and sends it via WhatsApp.
 *  2. The user types the 6-digit code; we call verify-phone-otp, which marks
 *     profiles.phone_verified and stores the number.
 *
 * Requires a signed-in session (reached after email verification).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'

const OTP_LENGTH = 6

/** Gambia's country code: complete numbers the user omits it from. */
const DEFAULT_COUNTRY_CODE = '220'

/**
 * Normalize to bare international digits (matches the server's format).
 * Users type bare 7-digit local numbers (e.g. 3552116), so if no country
 * code is present we complete it with 220 (Gambia). Handles the local
 * trunk prefix "0" (e.g. 03552116) as well.
 */
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  if (digits.length === 7) digits = DEFAULT_COUNTRY_CODE + digits
  return digits
}

const FULL_NUMBER_HINT =
  'Please enter your full phone number with country code, e.g. 220XXXXXXX'
const RATE_LIMIT_HINT = 'Too many codes requested. Please wait before trying again.'
const NETWORK_HINT = 'Connection problem. Check your internet and try again.'

/**
 * Turn a failed send-phone-otp response into an honest message: the real
 * reason (invalid number vs rate limit) instead of a generic network error.
 */
function classifySendError(status: number, message: string | undefined): string {
  const m = (message ?? '').toLowerCase()
  if (status === 429 || m.includes('too many') || m.includes('rate limit')) {
    return RATE_LIMIT_HINT
  }
  if (
    m.includes('invalid') ||
    m.includes('not a valid') ||
    m.includes('lid found') ||
    m.includes('no lid') ||
    m.includes('route') ||
    m.includes('not on whatsapp')
  ) {
    return FULL_NUMBER_HINT
  }
  // Anything else: show the server's actual message.
  return message && message.trim().length > 0 ? message : 'Could not send the code. Try again.'
}

export default function VerifyPhone() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [token, setToken] = useState('')
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    document.title = 'Verify phone · GamCiv'
  }, [])

  // 60s resend cooldown once a code has been sent.
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  async function authHeaders(): Promise<Record<string, string> | null> {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      navigate('/login', { replace: true })
      return null
    }
    return {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? '',
      'Content-Type': 'application/json',
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    const normalized = normalizePhone(phone)
    if (normalized.length < 9 || normalized.length > 15) {
      setError(FULL_NUMBER_HINT)
      return
    }
    const headers = await authHeaders()
    if (!headers) return
    setBusy(true)
    try {
      const res = await fetch(
        `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/+$/, '')}/functions/v1/auth-verify/send-phone-otp`,
        { method: 'POST', headers, body: JSON.stringify({ phone: normalized }) },
      )
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        setError(classifySendError(res.status, body.message))
        return
      }
      setStage('code')
      setResendIn(60)
    } catch {
      // Only a true network failure (fetch itself threw) says "connection".
      setError(NETWORK_HINT)
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (token.trim().length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code sent to your WhatsApp.`)
      return
    }
    const headers = await authHeaders()
    if (!headers) return
    setBusy(true)
    try {
      const res = await fetch(
        `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/+$/, '')}/functions/v1/auth-verify/verify-phone-otp`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone: normalizePhone(phone), code: token.trim() }),
        },
      )
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        const m = (body.message ?? '').toLowerCase()
        if (res.status === 429 || m.includes('too many')) setError(RATE_LIMIT_HINT)
        else if (m.includes('no active code')) setError('No active code. Request a new one.')
        else if (m.includes('expired')) setError('That code expired. Request a new one.')
        else if (m.includes('not correct') || m.includes('did not match')) {
          setError('That code is not correct. Check and try again.')
        } else setError(body.message ?? 'That code did not match. Check and try again.')
        return
      }
      navigate('/home', { replace: true })
    } catch {
      // Only a true network failure (fetch itself threw) says "connection".
      setError(NETWORK_HINT)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="items-center text-center">
          <Smartphone className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
          <CardTitle className="font-display text-xl font-bold">Verify your phone</CardTitle>
          <CardDescription>
            {stage === 'phone'
              ? 'We will send a one-time code to this number on WhatsApp to confirm it is yours.'
              : `Enter the ${OTP_LENGTH}-digit code sent to your WhatsApp.`}
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
              {error ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : 'Send code on WhatsApp'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verify-sms-code">6-digit WhatsApp code</Label>
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
              {error ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Verifying…' : 'Verify phone'}
              </Button>
              <button
                type="button"
                onClick={() => sendCode()}
                disabled={busy || resendIn > 0}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {resendIn > 0 ? `Resend code available in ${resendIn}s` : 'Resend code'}
              </button>
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
