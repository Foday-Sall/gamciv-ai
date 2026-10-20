import { supabase } from "@/lib/secretsClient"

export type DashRole = "admin" | "officer"

export interface SessionInfo {
  session: boolean
  role: DashRole | null
  error: boolean
}

type DashboardAccess = {
  ok?: boolean
  role?: "admin" | "officer" | "citizen" | null
}

/** Resolve session and role from the database's exact-email access policy. */
export async function resolveSessionRole(): Promise<SessionInfo> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const session = Boolean(sessionData.session)
  if (sessionError) return { session, role: null, error: true }
  if (!session) return { session: false, role: null, error: false }

  const { data, error } = await supabase.rpc("fn_dashboard_access")
  if (error) return { session: true, role: null, error: true }

  const access = data as DashboardAccess | null
  if (!access?.ok) return { session: true, role: null, error: false }
  if (access.role === "admin" || access.role === "officer") {
    return { session: true, role: access.role, error: false }
  }
  return { session: true, role: null, error: false }
}
