import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    // Storage key stays the library default, which supabase-js derives from
    // the Supabase URL (host 'api.pocketsoftware.dev' -> 'sb-api-auth-token').
    // It is shared with the citizen app ON PURPOSE: both apps live on the
    // origin gamciv.pocketsoftware.dev, so ONE login covers both. The
    // dashboard role-gates citizens (StaffGate), so a shared citizen session
    // only ever opens the citizen app, and a staff login is routed to
    // /dashboard. Do NOT add a per-app storageKey here without changing the
    // dashboard too: two keys means staff would have to log in twice.
  },
})

/**
 * Dashboard paths on this same origin (gamciv.pocketsoftware.dev). The
 * dedicated dashboard.pocketsoftware.dev domain is retired: the dashboard
 * app is served from /dashboard/ here, and /app/login is the single login
 * page for everyone. Role decides where a signed-in user lands:
 *   officer -> /dashboard/institute (their institution's dashboard)
 *   admin   -> /dashboard/          (full administrator console)
 */
export const STAFF_DASHBOARD_URL = 'https://gamciv.pocketsoftware.dev/dashboard/'
export const OFFICER_DASHBOARD_URL = 'https://gamciv.pocketsoftware.dev/dashboard/institute'

/**
 * The profiles table is keyed by `user_id` (not `id`) and has no `phone`
 * column: user_id, email, role, full_name, created_at.
 */
export type Profile = {
  user_id: string
  email: string | null
  role: 'citizen' | 'officer' | 'admin'
  full_name: string | null
  phone_verified: boolean
  email_verified: boolean
}

/** Fetch the auth user's profile row; null when it doesn't exist yet. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, role, full_name, phone_verified, email_verified')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return (data as Profile) ?? null
}

/**
 * Distinguish connection failures from application errors so the UI can say
 * "check your connection" instead of "not found" when the network is down.
 * supabase-js surfaces fetch failures as errors whose message/name matches
 * these patterns (FetchError, AuthRetryableFetchError, TypeError: Failed to fetch).
 */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string; code?: string }
  if (e.name === 'AuthRetryableFetchError') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    e.code === 'ENOTFOUND' ||
    e.code === 'ECONNREFUSED'
  )
}

/**
 * The session ended (expired token the refresh token couldn't renew, or a
 * rejected token): clear local auth state. Called by data-layer helpers when
 * the API returns 401 so the next navigation shows the login screen instead
 * of a page that silently cannot work.
 */
export async function handleAuthExpired(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
}

/**
 * Route the signed-in user to the right place for their role.
 * /app/login is the single login page for everyone; the role decides where
 * they land (same origin, so the session carries over):
 *   officer -> /dashboard/institute (their institution's dashboard)
 *   admin   -> /dashboard/          (full administrator console)
 * Staff get a full navigation so we leave the app entirely. Citizens and
 * unknown-role users stay here.
 * Returns the profile's role (or null when the lookup failed).
 */
export async function routeByRole(userId: string): Promise<'citizen' | 'officer' | 'admin' | null> {
  const profile = await getProfile(userId)
  const role = profile?.role
  if (role === 'officer') {
    window.location.href = OFFICER_DASHBOARD_URL
    return 'officer'
  }
  if (role === 'admin') {
    window.location.href = STAFF_DASHBOARD_URL
    return 'admin'
  }
  return role === 'citizen' ? 'citizen' : null
}

/**
 * True when a PostgREST error is a JWT/session problem (401 PGRST301/PGRST302).
 */
export function isAuthError(err: { code?: string; message?: string } | null | undefined): boolean {
  const code = err?.code ?? ''
  return code === 'PGRST301' || code === 'PGRST302' || (err?.message ?? '').includes('JWT')
}
