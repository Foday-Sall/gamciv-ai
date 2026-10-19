/**
 * Shared domain helpers for the citizen app: institutions, categories,
 * council areas and status metadata. All live data comes from the real
 * backend (api.pocketsoftware.dev) through the shared supabase client.
 */
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

/** The five branded services plus the central desk that handles sensitive reports. */
export type InstitutionCode = 'KMC' | 'NAWEC' | 'NRA' | 'NEA' | 'POLICE' | 'CENTRAL'

export type InstitutionInfo = {
  code: InstitutionCode
  id: string
  name: string
  type: string
  logo: string
  blurb: string
}

/** Static branding (logos live in public/logos); ids/names come from the institutions table. */
const BRAND: Record<InstitutionCode, { logo: string; blurb: string }> = {
  KMC: {
    logo: 'logos/kmc.png',
    blurb: 'Waste collection, street lighting, local roads, markets.',
  },
  NAWEC: {
    logo: 'logos/nawec.png',
    blurb: 'Water supply, electricity, sewerage.',
  },
  NRA: {
    logo: 'logos/nra.png',
    blurb: 'National roads, traffic signs, highways.',
  },
  NEA: {
    logo: 'logos/nea.png',
    blurb: 'Pollution, illegal dumping, public health, environment.',
  },
  POLICE: {
    logo: 'logos/police.png',
    blurb: 'Crime reports, police misconduct, emergencies.',
  },
  CENTRAL: {
    logo: '',
    blurb: 'Reports that need review first: fraud, abuse of power, fires and more.',
  },
}

const FALLBACK_NAMES: Record<InstitutionCode, string> = {
  KMC: 'Kanifing Municipal Council',
  NAWEC: 'National Water and Electricity Company',
  NRA: 'National Roads Authority',
  NEA: 'National Environment Agency',
  POLICE: 'Gambia Police Force',
  CENTRAL: 'GamCiv Central Desk',
}

/** Fallback order used when the institutions table is unreachable. */
export const INSTITUTION_ORDER: InstitutionCode[] = ['KMC', 'NAWEC', 'NRA', 'NEA', 'POLICE']

/**
 * Fetch the service cards for the wizard from the real institutions table.
 * Filters by code because POLICE has public_visible=false and would be
 * dropped by `public_visible=eq.true`.
 */
export async function fetchInstitutions(): Promise<InstitutionInfo[]> {
  const { data, error } = await supabase
    .from('institutions')
    .select('id, code, name, type')
    .in('code', [...INSTITUTION_ORDER, 'CENTRAL'])

  if (error || !data) {
    console.error('institutions fetch failed:', error?.message)
    // Don't fail silently: with fallback ids ('') submissions would break, so
    // tell the person the service list couldn't be loaded from the server.
    toast.warning("Couldn't load the service list — showing offline placeholders. Check your connection.")
    return [
      ...INSTITUTION_ORDER.map((code) => ({
        id: '',
        code,
        name: FALLBACK_NAMES[code],
        type: '',
        ...BRAND[code],
      })),
      { id: '', code: 'CENTRAL', name: FALLBACK_NAMES.CENTRAL, type: 'central', ...BRAND.CENTRAL },
    ]
  }

  const byCode = new Map<string, InstitutionInfo>()
  for (const row of data as Array<{ id: string; code: string; name: string; type: string }>) {
    const code = row.code as InstitutionCode
    if (!BRAND[code]) continue
    byCode.set(code, { id: row.id, code, name: row.name, type: row.type, ...BRAND[code] })
  }
  const ordered: InstitutionInfo[] = INSTITUTION_ORDER.map((c) => byCode.get(c)).filter(
    (v): v is InstitutionInfo => !!v,
  )
  if (byCode.has('CENTRAL')) ordered.push(byCode.get('CENTRAL')!)
  return ordered
}

/** A reportable problem category, as served by the categories table. */
export type CategoryInfo = {
  id: string
  slug: string
  name: string
  default_institution_id: string | null
  is_sensitive: boolean
  is_emergency: boolean
  deadline_hours: number | null
}

/** Static icon name (lucide) keyed by slug — the categories table has no icon column. */
export const CATEGORY_ICONS: Record<string, string> = {
  water_supply: 'Droplets',
  electricity: 'Zap',
  sewerage: 'Waves',
  waste_collection: 'Trash2',
  illegal_dumping: 'Factory',
  pollution: 'Wind',
  public_health: 'HeartPulse',
  streetlight: 'Lightbulb',
  local_roads: 'Construction',
  national_roads: 'Signpost',
  traffic_signs: 'Milestone',
  markets: 'Store',
  education: 'GraduationCap',
  crime_report: 'ShieldAlert',
  police_misconduct: 'Scale',
  abuse_of_power: 'HandCoins',
  corruption_report: 'HandCoins',
  emergency_fire: 'Flame',
  emergency_police: 'Siren',
  other: 'CircleHelp',
}

export function categoryIcon(slug: string): string {
  return CATEGORY_ICONS[slug] ?? 'CircleHelp'
}

/** The council areas the wizard offers (matches fn_resolve_location_institution aliases). */
export type CouncilArea = {
  value: string
  label: string
  lat: number
  lng: number
}

export const COUNCIL_AREAS: CouncilArea[] = [
  { value: 'kanifing', label: 'Kanifing (includes Serekunda)', lat: 13.52, lng: -16.69 },
  { value: 'banjul', label: 'Banjul', lat: 13.454, lng: -16.579 },
  { value: 'brikama', label: 'Brikama', lat: 13.29, lng: -16.73 },
]

/** Municipal bbox from the institutions table — used to clamp/snap GPS to a council area. */
export const MUNICIPAL_BBOXES: Record<string, [number, number, number, number]> = {
  kanifing: [13.48, -16.76, 13.56, -16.62],
}

/** Find which municipal bbox contains a coordinate, if any. */
export function councilForLatLng(lat: number, lng: number): string | null {
  for (const [value, [s, w, n, e]] of Object.entries(MUNICIPAL_BBOXES)) {
    if (lat >= s && lat <= n && lng >= w && lng <= e) return value
  }
  return null
}

/** Every status the complaint_status enum can hold. */
export type ComplaintStatus =
  | 'submitted'
  | 'received'
  | 'assigned'
  | 'in_progress'
  | 'waiting_info'
  | 'forwarded'
  | 'citizen_confirmation'
  | 'resolved'
  | 'closed'
  | 'rejected'
  | 'escalated'
  | 'reopened'

/** Badge variant + label for a complaint status. */
export function statusMeta(status: string | null | undefined): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
} {
  switch (status) {
    case 'resolved':
      return { label: 'Resolved', variant: 'default' }
    case 'closed':
      return { label: 'Closed', variant: 'secondary' }
    case 'rejected':
      return { label: 'Rejected', variant: 'destructive' }
    case 'in_progress':
      return { label: 'In progress', variant: 'default' }
    case 'waiting_info':
      return { label: 'Waiting for info', variant: 'outline' }
    case 'citizen_confirmation':
      return { label: 'Confirm fix', variant: 'outline' }
    case 'forwarded':
      return { label: 'Forwarded', variant: 'secondary' }
    case 'assigned':
      return { label: 'Assigned', variant: 'secondary' }
    case 'escalated':
      return { label: 'Escalated', variant: 'destructive' }
    case 'reopened':
      return { label: 'Reopened', variant: 'destructive' }
    case 'received':
      return { label: 'Received', variant: 'secondary' }
    case 'submitted':
    default:
      return { label: 'Submitted', variant: 'secondary' }
  }
}
