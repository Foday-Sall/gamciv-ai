import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { supabase, routeByRole } from '@/lib/supabase'
import { friendlyAuthError } from '@/lib/authErrors'
import GamCivMark from '@/components/GamCivMark'
import { StaffOtpSignIn } from '@/components/StaffOtpSignIn'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  MailIcon,
  LockIcon,
  UserIcon,
  EyeIcon,
  EyeOffIcon,
} from 'lucide-react'

/* The four-colour Google "G", drawn inline so we don't ship a logo asset. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19-.92.92C.92 17.06 0 20.34 0 24c0 3.66.92 6.94 2.56 9.86l7.97-6.27z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Password input with a working show/hide toggle, built on InputGroup. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  describedBy?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup>
        <InputGroupAddon>
          <LockIcon />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={6}
          aria-describedby={describedBy}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function FieldWithIcon({
  id,
  label,
  type,
  value,
  onChange,
  icon,
  autoComplete,
  placeholder,
  describedBy,
}: {
  id: string
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  icon: React.ReactNode
  autoComplete: string
  placeholder?: string
  describedBy?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup>
        <InputGroupAddon>{icon}</InputGroupAddon>
        <InputGroupInput
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          aria-describedby={describedBy}
        />
      </InputGroup>
    </div>
  )
}

export default function Auth({ initialMode }: { initialMode: 'signup' | 'signin' }) {
  const [mode, setMode] = useState<'signup' | 'signin'>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'form' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const isSignup = mode === 'signup'

  // The Supabase OAuth callback can land back on /app/ with error query/fragment
  // parameters (e.g. an expired state when the user stalls on the Google consent
  // screen, or a denied consent). Parse them once and surface them here instead
  // of leaving the user on a silent-looking form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const oauthError = params.get('error_description') || hashParams.get('error_description')
    const oauthCode = params.get('error_code') || hashParams.get('error_code')
    if (oauthError) {
      setError(
        oauthCode === 'bad_oauth_state' || /state|expired/i.test(oauthError)
          ? 'Sign-in timed out before Google confirmed it. Try again.'
          : friendlyAuthError(oauthError),
      )
      // Clean the OAuth error params out of the address bar. The app is
      // browser-routed, so keep the pathname and drop only the error query
      // string (the route itself never carries legitimate query params).
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname,
      )
    }
  }, [location.key])

  // Everyone signs in here. The server decides whether the session belongs
  // to a citizen, institution staff member, or the sole administrator.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled || !session) return
      const role = await routeByRole()
      if (cancelled) return
      if (role === 'citizen') {
        navigate('/home', { replace: true })
      } else if (!role) {
        setError('We could not confirm that this account is enabled for GamCiv. Contact the platform administrator.')
      }
    }).catch(() => {
      if (!cancelled) setError('We could not verify your account. Check your connection and try again.')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function switchMode(next: 'signup' | 'signin') {
    setMode(next)
    setError(null)
    navigate(next === 'signup' ? '/signup' : '/login', { replace: true })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (isSignup && name.trim().length < 2) {
      setError('Enter your full name so officials know who is reporting.')
      return
    }

    setBusy('form')
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (error) {
          setError(friendlyAuthError(error))
          return
        }
        if (data.session) {
          toast.success('Account created', {
            description: `Welcome to GamCiv, ${name.trim().split(' ')[0]}.`,
          })
          // New signups are citizens by default (the signup trigger sets the
          // role), but respect the actual profile role just in case.
          const routed = await routeByRole()
          if (routed !== 'officer' && routed !== 'admin') {
            // New accounts must confirm their email (OTP) before using the app.
            navigate('/verify/email', { replace: true })
          }
        } else if (data.user) {
          // Email confirmation is required: show the OTP screen right away
          // with the address pre-filled (the user has no session yet).
          navigate('/verify/email', {
            replace: true,
            state: { email: email.trim() },
          })
        } else {
          switchMode('signin')
        }
      } else {
        const { error, data: loginData } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) {
          if (error.message.toLowerCase().includes('email not confirmed')) {
            // Wrong password would say invalid credentials; this means the
            // account exists and needs its email verified first.
            navigate('/verify/email', {
              replace: true,
              state: { email: email.trim() },
            })
            return
          }
          setError(friendlyAuthError(error))
          return
        }
        // Role-aware routing: staff belong in the dashboard, citizens stay
        // here. Unknown role (profile lookup failed) stays too — do not trap
        // a citizen out of the app over a transient error.
        const routed = loginData.session
          ? await routeByRole()
          : null
        if (routed === null) {
          setError('This account is not enabled for GamCiv access. Contact the platform administrator.')
          return
        }
        if (routed === 'citizen') {
          // Unconfirmed email? Send to the OTP verification screen first.
          const unconfirmed =
            loginData.session?.user?.email_confirmed_at == null &&
            loginData.session?.user?.id != null
          navigate(unconfirmed ? '/verify/email' : '/home', { replace: true })
        }
      }
    } catch (err) {
      // signUp/signInWithPassword only reject on network failure (the library
      // returns HTTP errors as `error` objects); say so plainly.
      setError(friendlyAuthError(err))
    } finally {
      setBusy(null)
    }
  }

  async function signInWithGoogle() {
    setError(null)
    setBusy('google')
    try {
      const redirectTo = `${window.location.origin}/app/`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) {
        setError(friendlyAuthError(error))
        setBusy(null)
      }
      // On success the library assigns the browser to the Google authorize URL.
    } catch {
      setError(friendlyAuthError(new TypeError('Failed to fetch')))
      setBusy(null)
    }
  }

  const googleBusy = busy === 'google'
  const formBusy = busy === 'form'

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-10">
        <section className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col items-center text-center">
            <GamCivMark className="h-14 w-14 rounded-2xl shadow-sm" />
            <h1 className="mt-5 font-display text-2xl font-bold tracking-tight">
              {isSignup ? 'Create your GamCiv account' : 'Welcome back'}
            </h1>
            <p className="mt-2 max-w-sm text-muted-foreground">
              {isSignup
                ? 'Create a free account to report public problems and follow them until they are fixed.'
                : 'Sign in as a citizen or institution staff member to open your GamCiv workspace.'}
            </p>
          </div>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate={false}>
            {isSignup && (
              <FieldWithIcon
                id="fullname"
                label="Full name"
                type="text"
                value={name}
                onChange={setName}
                autoComplete="name"
                placeholder="e.g. Awa Njie"
                icon={<UserIcon />}
              />
            )}

            <FieldWithIcon
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="you@example.com"
              icon={<MailIcon />}
            />

            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              describedBy="password-hint"
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              At least 6 characters.
            </p>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <Button type="submit" className="h-11 w-full text-base" disabled={busy !== null}>
              {formBusy ? <Loader2 className="animate-spin" /> : null}
              {isSignup ? 'Sign up' : 'Sign in'}
            </Button>

            {!isSignup && (
              <Button
                type="button"
                variant="link"
                className="mx-auto block h-auto px-0 text-sm font-medium"
                onClick={() => navigate('/forgot-password', { state: { email } })}
              >
                Forgot password?
              </Button>
            )}
          </form>

          {!isSignup && <StaffOtpSignIn email={email} />}

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full text-base"
            onClick={signInWithGoogle}
            disabled={busy !== null}
          >
            {googleBusy ? (
              <Loader2 className="animate-spin" />
            ) : (
              <GoogleLogo />
            )}
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? 'Already have an account? ' : 'New to GamCiv? '}
            <button
              type="button"
              onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {isSignup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-md px-5 pb-6">
        <p className="rounded-lg border border-border/80 bg-card/60 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
          Free to use. Your reports are public data; your account details are not.
        </p>
      </footer>
    </div>
  )
}
