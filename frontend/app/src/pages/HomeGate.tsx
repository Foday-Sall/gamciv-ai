import { useSession } from '@/hooks/useSession'
import InstituteDashboard from '@/pages/InstituteDashboard'
import { getProfile } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import Home from '@/pages/Home'

/**
 * /home — router between the citizen home and the institute dashboard.
 *
 * Institutional users (profile role `officer` with a row in the `officers`
 * table) get the live complaints dashboard; everyone else sees the standard
 * citizen home. Both render under the shared AppShell.
 */
export default function HomeGate() {
  const { session, loading } = useSession()
  const [institute, setInstitute] = useState<boolean | null>(null)

  useEffect(() => {
    if (loading) return
    const user = session?.user
    if (!user) {
      setInstitute(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const profile = await getProfile(user.id)
      if (profile?.role !== 'officer') {
        if (!cancelled) setInstitute(false)
        return
      }
      const { getInstituteUser } = await import('@/lib/institute')
      const staff = await getInstituteUser(user.id)
      if (!cancelled) setInstitute(staff !== null)
    })()
    return () => {
      cancelled = true
    }
  }, [session?.user?.id, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || institute === null) {
    // Citizen home already renders skeletons while its own session resolves.
    return <Home />
  }

  return institute ? <InstituteDashboard /> : <Home />
}
