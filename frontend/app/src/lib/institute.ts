// Data + actions for institutional users (staff) inside the citizen app.
// The officers table (backend/db/0004_officer.sql) ties an auth user to an
// institution; its complaints feed is the institute dashboard's source.
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export type InstituteUser = {
  officerId: string
  institutionId: string
  institutionName: string
}

export type InstituteDashboardStats = {
  institution: { id: string; code: string; name: string }
  total: number
  today: number
  open: number
  resolved_week: number
  overdue: number
  avg_resolution_hours: number
  by_status: Array<{ status: string; count: number }>
  by_category: Array<{ category: string; count: number }>
  by_channel: Array<{ channel: string; count: number }>
  by_urgency: Array<{ urgency: string; count: number }>
  daily: Array<{ date: string; received: number; resolved: number }>
}

/** Look up the signed-in user's officers row; null when they are not staff. */
export async function getInstituteUser(userId: string): Promise<InstituteUser | null> {
  const { data, error } = await supabase
    .from('officers')
    .select('id, institution_id, institutions(name)')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const inst = Array.isArray(data.institutions)
    ? (data.institutions[0] as { name: string } | null)
    : (data.institutions as { name: string } | null)
  return {
    officerId: data.id as string,
    institutionId: data.institution_id as string,
    institutionName: inst?.name ?? 'Institution',
  }
}

/** Load aggregate metrics for the signed-in officer's institution only. */
export async function getInstituteDashboardStats(): Promise<InstituteDashboardStats | null> {
  const { data, error } = await supabase.rpc('fn_institution_dashboard_stats')
  if (error || !data || (data as { ok?: boolean }).ok === false) {
    if (error) console.error('institution dashboard stats failed:', error.message)
    return null
  }
  return data as InstituteDashboardStats
}

const NOTE_MIN = 10

function requireNote(action: string): string | null {
  const note = window.prompt(`Describe the "${action}" note (at least ${NOTE_MIN} characters):`)
  if (!note || note.trim().length < NOTE_MIN) {
    toast.error(`A ${action} needs a note of at least ${NOTE_MIN} characters.`)
    return null
  }
  return note.trim()
}

/** Call one officer RPC; surface a friendly toast on failure. */
async function callOfficerRpc(
  rpc: string,
  args: Record<string, unknown>,
  complaintId: string,
): Promise<boolean> {
  const { error } = await supabase.rpc(rpc, { p_complaint_id: complaintId, ...args })
  if (error) {
    toast.error(`Could not ${rpc.replace('fn_officer_', '').replaceAll('_', ' ')}: ${error.message}`)
    return false
  }
  return true
}

export async function officerAccept(complaintId: string): Promise<boolean> {
  return callOfficerRpc('fn_officer_accept', {}, complaintId)
}

export async function officerReject(complaintId: string): Promise<boolean> {
  const reason = requireNote('Reject')
  if (!reason) return false
  return callOfficerRpc('fn_officer_reject', { p_reason: reason }, complaintId)
}

export async function officerRequestInfo(complaintId: string): Promise<boolean> {
  const message = requireNote('Request info')
  if (!message) return false
  return callOfficerRpc('fn_officer_request_info', { p_message: message }, complaintId)
}

export async function officerSetStatus(
  complaintId: string,
  status: 'in_progress' | 'resolved',
  opts?: { withNote?: boolean },
): Promise<boolean> {
  let citizenMessage: string | null = null
  if (opts?.withNote) {
    citizenMessage = requireNote(status === 'resolved' ? 'Resolution note' : 'Progress note')
    if (!citizenMessage) return false
  }
  return callOfficerRpc(
    'fn_officer_set_status',
    { p_status: status, p_citizen_message: citizenMessage },
    complaintId,
  )
}

export async function officerAttachProof(complaintId: string): Promise<boolean> {
  const url = window.prompt('Paste the public URL of the resolution proof photo:')
  if (!url) return false
  return callOfficerRpc('fn_officer_attach_proof', { p_photo_url: url.trim() }, complaintId)
}

export async function officerForward(
  complaintId: string,
  institutions: Array<{ id: string; name: string }>,
): Promise<boolean> {
  if (institutions.length === 0) {
    toast.error('No other institutions are available to forward to.')
    return false
  }
  const list = institutions.map((i, idx) => `${idx + 1}. ${i.name}`).join('\n')
  const picked = window.prompt(`Forward to which institution?\n\n${list}\n\nEnter the number:`)
  if (!picked) return false
  const target = institutions[Number(picked) - 1]
  if (!target) {
    toast.error('Pick a number from the list.')
    return false
  }
  const reason = requireNote('Forward')
  if (!reason) return false
  return callOfficerRpc(
    'fn_officer_forward',
    { p_institution_id: target.id, p_reason: reason },
    complaintId,
  )
}
