import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    // Keep the library's default storage key so the citizen app and /dash
    // share one persisted session on this origin. Server-verified role checks
    // route citizens to the app and the owner or institution staff to /dash.
    // Do not add a per-app storageKey without changing both clients.
  },
})

/**
 * Dashboard paths on this same origin. /app/login is the single login page;
 * the server-verified role decides which workspace appears at /dash.
 */
export const STAFF_DASHBOARD_URL = 'https://gamciv.pocketsoftware.dev/dash'
export const OFFICER_DASHBOARD_URL = STAFF_DASHBOARD_URL

/**
 * The profiles table is keyed by `user_id`; routing reads only the fields
 * listed below. Reporter contact details are fetched through an authorized RPC.
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
 * Resolve role and institution scope through the server-side allowlist.
 * Both the owner and institution staff use the same persisted Supabase session
 * and land at /dash; the dashboard server decides which workspace to render.
 */
export async function routeByRole(): Promise<'citizen' | 'officer' | 'admin' | null> {
  const { data, error } = await supabase.rpc('fn_dashboard_access')
  if (error) throw error
  const access = data as { ok?: boolean; role?: 'citizen' | 'officer' | 'admin' | null } | null
  if (!access?.ok) return null
  const role = access.role
  if (role === 'officer') {
    window.location.replace(OFFICER_DASHBOARD_URL)
    return 'officer'
  }
  if (role === 'admin') {
    window.location.replace(STAFF_DASHBOARD_URL)
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
