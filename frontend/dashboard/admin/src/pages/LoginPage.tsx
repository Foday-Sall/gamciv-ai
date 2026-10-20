/**
 * LoginPage — the dashboard's own sign-in screen at /dashboard/login.
 *
 * Two ways in, same destination:
 *   1. "Email me a code" — native Supabase passwordless OTP
 *      (signInWithOtp with shouldCreateUser:false, then verifyOtp type
 *      "email"). The 6-digit code arrives from noreply@pocketsoftware.dev
 *      via the GoTrue send-email hook.
 *   2. Email + password — the existing fallback, kept for demo safety.
 *
 * After a successful sign-in the gate (main.tsx) resolves the profile role
 * and routes admins to the console and officers to their institution view.
 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Mail, ShieldCheck, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/secretsClient"
import { resolveSessionRole, type SessionInfo } from "@/lib/authGate"

type Mode = "choose" | "otp-email" | "otp-code" | "password"

const OTP_LENGTH = 6

/** Map raw auth errors to sentences that tell the person what to do. */
function authErrorText(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials"))
    return "Wrong email or password. Check them and try again."
  if (m.includes("rate limit") || m.includes("too many") || m.includes("over_email_send_rate_limit"))
    return "Too many codes requested. Wait a minute and try again."
  if (m.includes("already confirmed")) return "This email is already verified. Just sign in."
  if (m.includes("signups not allowed") || m.includes("not allowed"))
    return "This email is not registered for dashboard access. Ask the administrator."
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Check your connection and try again."
  return message
}

/** Route a signed-in session by role. Returns where it sent the user. */
async function routeByRole(info: SessionInfo): Promise<boolean> {
  if (info.role === "admin") {
    window.location.href = "/"
    return true
  }
  if (info.role === "officer") {
    window.location.href = "/institute"
    return true
  }
  return false
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>("choose")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resentIn, setResentIn] = useState(0)

  // Already signed in? Route straight away (one-shot, on mount).
  useEffect(() => {
    let cancelled = false
    resolveSessionRole().then(async (info) => {
      if (cancelled || !info.session) return
      await routeByRole(info)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Resend cooldown ticker.
  useEffect(() => {
    if (resentIn <= 0) return
    const timer = setTimeout(() => setResentIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resentIn])

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError("Enter the email your GamCiv account was issued to.")
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    })
    setBusy(false)
    if (err) {
      setError(authErrorText(err.message))
      return
    }
    setSentTo(email.trim())
    setMode("otp-code")
    setResentIn(60)
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (code.trim().length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code from your email.`)
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.verifyOtp({
      email: (sentTo ?? email).trim(),
      token: code.trim(),
      type: "email",
    })
    setBusy(false)
    if (err) {
      setError(
        /expired/i.test(err.message)
          ? "That code has expired. Request a new one."
          : /invalid/i.test(err.message)
            ? "That code is not right. Check the latest email and try again."
            : authErrorText(err.message),
      )
      return
    }
    // Session is now stored; the gate routes by role.
    const info = await resolveSessionRole()
    if (!(await routeByRole(info))) {
      // Signed in but not staff: bounce to the citizen app login.
      navigate("/app/login", { replace: true })
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError("Enter your email and password.")
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (err) {
      if (err.message.toLowerCase().includes("email not confirmed")) {
        setError("This email has not been confirmed yet. Use the code option below.")
        return
      }
      setError(authErrorText(err.message))
      return
    }
    const info = await resolveSessionRole()
    if (!(await routeByRole(info))) {
      navigate("/app/login", { replace: true })
    }
  }

  const busySpinner = busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">
            A
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            GamCiv Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage complaints and institutions.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {mode === "choose" && (
            <div className="space-y-4">
              <form onSubmit={requestOtp} className="space-y-3">
                <label htmlFor="otp-email" className="block text-sm font-medium">
                  Email
                </label>
                <Input
                  id="otp-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@pocketsoftware.dev"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button type="submit" className="h-11 w-full" disabled={busy}>
                  {busy ? busySpinner : <Mail aria-hidden="true" />}
                  Email me a code
                </Button>
              </form>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                onClick={() => {
                  setError(null)
                  setMode("password")
                }}
                disabled={busy}
              >
                <KeyRound aria-hidden="true" />
                Sign in with password
              </Button>
            </div>
          )}

          {mode === "otp-code" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="text-center">
                <ShieldCheck className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Enter the 6-digit code sent to <span className="font-medium text-foreground">{sentTo}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">It expires in 15 minutes.</p>
              </div>
              <Input
                id="otp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="······"
                className="text-center font-mono text-lg tracking-[0.5em]"
                required
              />
              <Button type="submit" className="h-11 w-full" disabled={busy}>
                {busy ? busySpinner : null}
                Verify and sign in
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => {
                    setMode("choose")
                    setCode("")
                    setError(null)
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline disabled:opacity-50"
                  onClick={() => void requestOtp()}
                  disabled={busy || resentIn > 0}
                >
                  {resentIn > 0 ? `Resend available in ${resentIn}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {mode === "password" && (
            <form onSubmit={signInWithPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="pw-email" className="block text-sm font-medium">
                  Email
                </label>
                <Input
                  id="pw-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pw-password" className="block text-sm font-medium">
                  Password
                </label>
                <Input
                  id="pw-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="h-11 w-full" disabled={busy}>
                {busy ? busySpinner : null}
                Sign in
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setMode("choose")
                    setPassword("")
                    setError(null)
                  }}
                >
                  Use a one-time code instead
                </button>
              </div>
            </form>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Protected area. Accounts are issued by the GamCiv administrator.
        </p>
      </div>
    </div>
  )
}
