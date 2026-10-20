import { supabase } from "@/lib/secretsClient"

/**
 * Auth gate helpers for the dashboard.
 *
 * One session storage key is shared with the citizen app (same Supabase
 * project, same origin), so a login from /app/login or the OTP login here
 * covers both. The gate resolves the session + profile role server-side
 * (profiles table read is RLS-protected: users see their own row) and routes:
 *
 *   role = admin   -> /            (full administrator console)
 *   role = officer -> /institute   (own-institution dashboard, RLS-scoped)
 *   no session     -> /login       (login screen only)
 */

export type DashRole = "admin" | "officer"

export interface SessionInfo {
  session: boolean
  role: DashRole | null
}

/** Resolve the current session and dashboard role. */
export async function resolveSessionRole(): Promise<SessionInfo> {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) return { session: false, role: null }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle()
  const role = profile?.role
  if (role === "admin" || role === "officer") return { session: true, role }
  // Citizen or unknown role: not dashboard material.
  return { session: true, role: null }
}

/** True when a PostgREST error is a JWT/session problem. */
export function isAuthError(err: { code?: string; message?: string } | null | undefined): boolean {
  const code = err?.code ?? ""
  return code === "PGRST301" || code === "PGRST302" || (err?.message ?? "").includes("JWT")
}
