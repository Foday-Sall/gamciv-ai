import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Single source of truth for auth state. Subscribes to onAuthStateChange so
 * token refreshes and the OAuth return both update the UI without reloads.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setLoading(false))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return { session, loading }
}

/** The signed-in user's display name: profile row first, then metadata. */
export function useDisplayName(session: Session | null) {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const user = session?.user
    if (!user) {
      setName(null)
      return
    }
    const meta = user.user_metadata ?? {}
    const fallback =
      (meta.full_name as string) ||
      (meta.name as string) ||
      (meta.user_name as string) ||
      user.email ||
      'Your account'
    setName(fallback)

    supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.full_name) setName(data.full_name)
      })

    return () => {
      cancelled = true
    }
  }, [session])

  return name
}
