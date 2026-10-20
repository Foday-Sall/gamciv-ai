// Admin API client. The overview uses a live, server-authorized Supabase RPC;
// several legacy admin-management pages below still contain prototype data.

import { supabase } from "@/lib/secretsClient"

export type InstitutionStatus = "active" | "suspended"

export interface Institution {
  id: string
  name: string
  shortCode: string
  contactEmail: string
  contactPhone: string
  categoryScope: string[]
  openComplaints: number
  officers: number
  accessLevel: "full" | "restricted" | "view-only"
  status: InstitutionStatus
}

export type OfficerRole = "institution-admin" | "officer" | "view-only"

export interface Officer {
  id: string
  name: string
  username: string
  email: string
  institutionId: string
  institutionName: string
  role: OfficerRole
  department: string
  active: boolean
}

export interface AccessLimits {
  institutionId: string
  accessLevel: "full" | "restricted" | "view-only"
  allowedCategories: string[]
  slaHours: number
  maxPerDay: number
}

export type AuditType =
  | "created"
  | "updated"
  | "suspended"
  | "reactivated"
  | "access_changed"
  | "settings_changed"

export interface AuditEntry {
  id: string
  actor: string
  type: AuditType
  action: string
  target: string
  at: string
}

export interface OverviewStats {
  totalComplaints: number
  openComplaints: number
  escalatedToday: number
  avgFirstResponseHours: number
  complaintsByCategory: { category: string; count: number }[]
  last14Days: { date: string; received: number }[]
}

export interface AdminSettings {
  escalationThresholds: Record<"critical" | "high" | "medium" | "low", number>
  notifications: {
    onEscalation: boolean
    onSlaBreach: boolean
    onAccountCreated: boolean
    onAccessChange: boolean
    weeklyDigest: boolean
  }
}

const CATEGORY_NAMES = [
  "Water",
  "Electricity",
  "Sanitation",
  "Roads",
  "Taxes",
  "Environment",
  "Police",
  "Fire",
  "Consumer",
] as const

export const ALL_CATEGORIES: string[] = [...CATEGORY_NAMES]

const INSTITUTION_SEED: Array<
  Pick<Institution, "id" | "name" | "shortCode" | "contactEmail" | "contactPhone"> & {
    categoryScope: string[]
  }
> = [
  {
    id: "inst-nawec",
    name: "NAWEC",
    shortCode: "NAWEC",
    contactEmail: "support@nawec.gm",
    contactPhone: "+220 421 7117",
    categoryScope: ["Water", "Electricity"],
  },
  {
    id: "inst-kmc",
    name: "Kanifing Municipal Council",
    shortCode: "KMC",
    contactEmail: "info@kmc.gov.gm",
    contactPhone: "+220 439 7777",
    categoryScope: ["Sanitation", "Roads"],
  },
  {
    id: "inst-nra",
    name: "National Roads Authority",
    shortCode: "NRA",
    contactEmail: "info@nra.gm",
    contactPhone: "+220 438 9022",
    categoryScope: ["Roads"],
  },
  {
    id: "inst-nea",
    name: "National Environment Agency",
    shortCode: "NEA",
    contactEmail: "info@nea.gm",
    contactPhone: "+220 449 8021",
    categoryScope: ["Environment", "Sanitation"],
  },
  {
    id: "inst-police",
    name: "Gambia Police Force",
    shortCode: "POLICE",
    contactEmail: "pr@police.gm",
    contactPhone: "+220 422 0000",
    categoryScope: ["Police"],
  },
  {
    id: "inst-fire",
    name: "Gambia Fire and Rescue Service",
    shortCode: "FIRE",
    contactEmail: "info@fire.gm",
    contactPhone: "+220 449 2222",
    categoryScope: ["Fire"],
  },
  {
    id: "inst-ombudsman",
    name: "Office of the Ombudsman",
    shortCode: "OMB",
    contactEmail: "info@ombudsman.gm",
    contactPhone: "+220 422 4125",
    categoryScope: ["Consumer"],
  },
]

const INSTITUTIONS: Institution[] = [
  { ...INSTITUTION_SEED[0], openComplaints: 43, officers: 12, accessLevel: "full", status: "active" },
  { ...INSTITUTION_SEED[1], openComplaints: 57, officers: 9, accessLevel: "full", status: "active" },
  { ...INSTITUTION_SEED[2], openComplaints: 28, officers: 6, accessLevel: "restricted", status: "active" },
  { ...INSTITUTION_SEED[3], openComplaints: 19, officers: 5, accessLevel: "restricted", status: "active" },
  { ...INSTITUTION_SEED[4], openComplaints: 34, officers: 8, accessLevel: "view-only", status: "active" },
  { ...INSTITUTION_SEED[5], openComplaints: 7, officers: 3, accessLevel: "restricted", status: "active" },
  { ...INSTITUTION_SEED[6], openComplaints: 4, officers: 2, accessLevel: "view-only", status: "suspended" },
]

const OFFICERS: Officer[] = [
  {
    id: "acct-1001",
    name: "Lamin Sanneh",
    username: "lsanneh",
    email: "l.sanneh@nawec.gm",
    institutionId: "inst-nawec",
    institutionName: "NAWEC",
    role: "institution-admin",
    department: "Distribution",
    active: true,
  },
  {
    id: "acct-1002",
    name: "Fatou Ceesay",
    username: "fceesay",
    email: "f.ceesay@kmc.gov.gm",
    institutionId: "inst-kmc",
    institutionName: "Kanifing Municipal Council",
    role: "officer",
    department: "Cleansing Services",
    active: true,
  },
  {
    id: "acct-1003",
    name: "Modou Camara",
    username: "mcamara",
    email: "m.camara@nra.gm",
    institutionId: "inst-nra",
    institutionName: "National Roads Authority",
    role: "officer",
    department: "Maintenance",
    active: true,
  },
  {
    id: "acct-1004",
    name: "Isatou Jallow",
    username: "ijallow",
    email: "i.jallow@nea.gm",
    institutionId: "inst-nea",
    institutionName: "National Environment Agency",
    role: "institution-admin",
    department: "Complaints Unit",
    active: true,
  },
  {
    id: "acct-1005",
    name: "Babucarr Njie",
    username: "bnjie",
    email: "b.njie@police.gm",
    institutionId: "inst-police",
    institutionName: "Gambia Police Force",
    role: "view-only",
    department: "Public Relations",
    active: false,
  },
  {
    id: "acct-1006",
    name: "Awa Drammeh",
    username: "adrammeh",
    email: "a.drammeh@fire.gm",
    institutionId: "inst-fire",
    institutionName: "Gambia Fire and Rescue Service",
    role: "officer",
    department: "Operations",
    active: true,
  },
  {
    id: "acct-1007",
    name: "Ousman Krubally",
    username: "okrubally",
    email: "o.krubally@ombudsman.gm",
    institutionId: "inst-ombudsman",
    institutionName: "Office of the Ombudsman",
    role: "officer",
    department: "Casework",
    active: true,
  },
  {
    id: "acct-1008",
    name: "Mariama Sonko",
    username: "msonko",
    email: "m.sonko@nawec.gm",
    institutionId: "inst-nawec",
    institutionName: "NAWEC",
    role: "officer",
    department: "Customer Care",
    active: true,
  },
]

const ACCESS_LIMITS: Record<string, AccessLimits> = {
  "inst-nawec": {
    institutionId: "inst-nawec",
    accessLevel: "full",
    allowedCategories: ["Water", "Electricity"],
    slaHours: 24,
    maxPerDay: 50,
  },
  "inst-kmc": {
    institutionId: "inst-kmc",
    accessLevel: "full",
    allowedCategories: ["Sanitation", "Roads"],
    slaHours: 48,
    maxPerDay: 40,
  },
  "inst-nra": {
    institutionId: "inst-nra",
    accessLevel: "restricted",
    allowedCategories: ["Roads"],
    slaHours: 72,
    maxPerDay: 20,
  },
  "inst-nea": {
    institutionId: "inst-nea",
    accessLevel: "restricted",
    allowedCategories: ["Environment", "Sanitation"],
    slaHours: 48,
    maxPerDay: 25,
  },
  "inst-police": {
    institutionId: "inst-police",
    accessLevel: "view-only",
    allowedCategories: ["Police"],
    slaHours: 12,
    maxPerDay: 30,
  },
  "inst-fire": {
    institutionId: "inst-fire",
    accessLevel: "restricted",
    allowedCategories: ["Fire"],
    slaHours: 6,
    maxPerDay: 10,
  },
  "inst-ombudsman": {
    institutionId: "inst-ombudsman",
    accessLevel: "view-only",
    allowedCategories: ["Consumer"],
    slaHours: 96,
    maxPerDay: 5,
  },
}

const AUDIT_LOG: AuditEntry[] = [
  {
    id: "audit-041",
    actor: "Administrator",
    type: "settings_changed",
    action: "Updated escalation threshold for critical complaints",
    target: "Settings",
    at: "2026-10-19T09:41:00Z",
  },
  {
    id: "audit-040",
    actor: "Administrator",
    type: "access_changed",
    action: "Set access level to view-only",
    target: "Office of the Ombudsman",
    at: "2026-10-18T16:08:00Z",
  },
  {
    id: "audit-039",
    actor: "Administrator",
    type: "suspended",
    action: "Suspended account",
    target: "Babucarr Njie",
    at: "2026-10-18T15:52:00Z",
  },
  {
    id: "audit-038",
    actor: "Administrator",
    type: "created",
    action: "Issued account for new officer",
    target: "Mariama Sonko",
    at: "2026-10-18T11:27:00Z",
  },
  {
    id: "audit-037",
    actor: "Administrator",
    type: "access_changed",
    action: "Changed SLA hours from 72 to 48",
    target: "Kanifing Municipal Council",
    at: "2026-10-17T14:03:00Z",
  },
  {
    id: "audit-036",
    actor: "Administrator",
    type: "created",
    action: "Created institution",
    target: "National Roads Authority",
    at: "2026-10-16T09:15:00Z",
  },
  {
    id: "audit-035",
    actor: "Administrator",
    type: "reactivated",
    action: "Reactivated account",
    target: "Awa Drammeh",
    at: "2026-10-15T10:44:00Z",
  },
  {
    id: "audit-034",
    actor: "Administrator",
    type: "access_changed",
    action: "Updated allowed categories",
    target: "National Environment Agency",
    at: "2026-10-14T08:30:00Z",
  },
]

const SETTINGS: AdminSettings = {
  escalationThresholds: {
    critical: 4,
    high: 12,
    medium: 48,
    low: 96,
  },
  notifications: {
    onEscalation: true,
    onSlaBreach: true,
    onAccountCreated: false,
    onAccessChange: true,
    weeklyDigest: true,
  },
}

function createInstitutionId(): string {
  return "inst-" + Math.random().toString(36).slice(2, 8)
}

function createAccountId(): string {
  return "acct-" + Math.random().toString(36).slice(2, 8)
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const { data, error } = await supabase.rpc("admin_get_overview_stats")
  if (error) throw error
  const result = data as {
    ok?: boolean
    error?: string
    total?: number | string
    open?: number | string
    escalated_today?: number | string
    avg_first_response_minutes?: number | string
    per_category?: Array<{ category?: string; count?: number | string }>
    daily?: Array<{ date?: string; count?: number | string }>
  } | null
  if (!result?.ok) throw new Error(result?.error || "Overview data is unavailable")

  return {
    totalComplaints: Number(result.total ?? 0),
    openComplaints: Number(result.open ?? 0),
    escalatedToday: Number(result.escalated_today ?? 0),
    avgFirstResponseHours: Number(result.avg_first_response_minutes ?? 0) / 60,
    complaintsByCategory: (result.per_category ?? [])
      .map((item) => ({ category: item.category || "Uncategorized", count: Number(item.count ?? 0) }))
      .sort((a, b) => b.count - a.count),
    last14Days: (result.daily ?? []).map((item) => ({
      date: item.date
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
            .format(new Date(`${item.date}T12:00:00Z`))
        : "—",
      received: Number(item.count ?? 0),
    })),
  }
}

export async function getInstitutions(): Promise<Institution[]> {
  // TODO: real RPC name: getInstitutions
  return INSTITUTIONS.map((entry) => ({ ...entry, categoryScope: [...entry.categoryScope] }))
}

export async function createInstitution(data: {
  name: string
  shortCode: string
  contactEmail: string
  contactPhone: string
  categoryScope: string[]
}): Promise<Institution> {
  // TODO: real RPC name: createInstitution
  const institution: Institution = {
    id: createInstitutionId(),
    name: data.name,
    shortCode: data.shortCode.toUpperCase(),
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    categoryScope: [...data.categoryScope],
    openComplaints: 0,
    officers: 0,
    accessLevel: "restricted",
    status: "active",
  }
  INSTITUTIONS.push(institution)
  return { ...institution }
}

export async function getOfficers(): Promise<Officer[]> {
  // TODO: real RPC name: getOfficers
  return OFFICERS.map((entry) => ({ ...entry }))
}

export async function createOfficer(data: {
  name: string
  username: string
  email: string
  institutionId: string
  role: OfficerRole
  department: string
}): Promise<{ officer: Officer; temporaryPassword: string }> {
  // TODO: real RPC name: createOfficer. Returns the generated temporary
  // password the administrator hands to the institution.
  const institution = INSTITUTIONS.find((entry) => entry.id === data.institutionId)
  const officer: Officer = {
    id: createAccountId(),
    name: data.name,
    username: data.username.toLowerCase(),
    email: data.email,
    institutionId: data.institutionId,
    institutionName: institution ? institution.name : data.institutionId,
    role: data.role,
    department: data.department,
    active: true,
  }
  OFFICERS.push(officer)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  let temporaryPassword = ""
  for (let i = 0; i < 12; i += 1) {
    temporaryPassword += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  temporaryPassword += "!7Aa"
  return { officer: { ...officer }, temporaryPassword }
}

export async function toggleOfficerActive(id: string, active: boolean): Promise<Officer> {
  // TODO: real RPC name: toggleOfficerActive
  const officer = OFFICERS.find((entry) => entry.id === id)
  if (!officer) throw new Error("Account not found")
  officer.active = active
  return { ...officer }
}

export async function getAccessLimits(institutionId: string): Promise<AccessLimits> {
  // TODO: real RPC name: getAccessLimits
  const existing = ACCESS_LIMITS[institutionId]
  if (existing) return { ...existing, allowedCategories: [...existing.allowedCategories] }
  const institution = INSTITUTIONS.find((entry) => entry.id === institutionId)
  return {
    institutionId,
    accessLevel: institution ? institution.accessLevel : "restricted",
    allowedCategories: institution ? [...institution.categoryScope] : [],
    slaHours: 48,
    maxPerDay: 20,
  }
}

export async function setAccessLevel(id: string, level: AccessLimits["accessLevel"]): Promise<void> {
  // TODO: real RPC name: setAccessLevel
  const limits = ACCESS_LIMITS[id]
  if (limits) limits.accessLevel = level
  const institution = INSTITUTIONS.find((entry) => entry.id === id)
  if (institution) institution.accessLevel = level
}

export async function setAllowedCategories(id: string, categories: string[]): Promise<void> {
  // TODO: real RPC name: setAllowedCategories
  const limits = ACCESS_LIMITS[id]
  if (limits) limits.allowedCategories = [...categories]
  const institution = INSTITUTIONS.find((entry) => entry.id === id)
  if (institution) institution.categoryScope = [...categories]
}

export async function setSlaHours(id: string, hours: number): Promise<void> {
  // TODO: real RPC name: setSlaHours
  const limits = ACCESS_LIMITS[id]
  if (limits) limits.slaHours = hours
}

export async function setRateLimit(id: string, maxPerDay: number): Promise<void> {
  // TODO: real RPC name: setRateLimit
  const limits = ACCESS_LIMITS[id]
  if (limits) limits.maxPerDay = maxPerDay
}

export async function getAuditLog(): Promise<AuditEntry[]> {
  // TODO: real RPC name: getAuditLog
  return AUDIT_LOG.map((entry) => ({ ...entry }))
}

export async function getSettings(): Promise<AdminSettings> {
  // TODO: real RPC name: getSettings
  return {
    escalationThresholds: { ...SETTINGS.escalationThresholds },
    notifications: { ...SETTINGS.notifications },
  }
}

export async function saveSettings(data: AdminSettings): Promise<void> {
  // TODO: real RPC name: saveSettings
  SETTINGS.escalationThresholds = { ...data.escalationThresholds }
  SETTINGS.notifications = { ...data.notifications }
}

// ---------------------------------------------------------------------------
// Secrets manager (admin-secrets edge function)
// ---------------------------------------------------------------------------

export interface SecretEntry {
  key: string
  set: boolean
  updatedAt: string | null
}

export interface SecretsStatus {
  ok: boolean
  keysManaged: number
  lastReloadOk: boolean | null
  lastReloadAt: number | null
}

export interface SecretsAuditEntry {
  id: string
  action: string
  key: string
  createdAt: string
  adminEmail: string | null
}

const SECRETS_URL = "https://api.pocketsoftware.dev/functions/v1/admin-secrets"

/**
 * Call the admin-secrets edge function with the current admin session.
 * Shares the same-origin supabase session used by the citizen app.
 */
async function secretsCall(
  action: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const { supabase } = await import("./secretsClient")
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error("Not signed in")
  const res = await fetch(SECRETS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, params }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return (await res.json()) as Record<string, unknown>
}

export async function listSecrets(): Promise<SecretEntry[]> {
  const payload = await secretsCall("list")
  const entries = (payload.data as { entries?: Array<{ key: string; set: boolean; updated_at: string | null }> })
    ?.entries ?? []
  return entries.map((entry) => ({
    key: entry.key,
    set: entry.set,
    updatedAt: entry.updated_at,
  }))
}

export async function getSecretsStatus(): Promise<SecretsStatus> {
  const payload = await secretsCall("get_status")
  const data = payload.data as {
    ok?: boolean
    keys_managed?: number
    last_reload_ok?: boolean | null
    last_reload_at?: number | null
  }
  return {
    ok: Boolean(data?.ok),
    keysManaged: data?.keys_managed ?? 0,
    lastReloadOk: data?.last_reload_ok ?? null,
    lastReloadAt: data?.last_reload_at ?? null,
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  await secretsCall("set", { key, value })
}

export async function deleteSecret(key: string): Promise<void> {
  await secretsCall("delete", { key })
}

export async function getSecretsAudit(limit = 50): Promise<SecretsAuditEntry[]> {
  const payload = await secretsCall("get_audit", { limit })
  const rows = (payload.data as Array<{
    id: string
    action: string
    key: string
    created_at: string
    admin_email: string | null
  }>) ?? []
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    key: row.key,
    createdAt: row.created_at,
    adminEmail: row.admin_email,
  }))
}

// ---------------------------------------------------------------------------
// WhatsApp numbers manager (admin-whatsapp edge function)
// ---------------------------------------------------------------------------

export type WhatsappRole = 'otp' | 'chat'
export type WhatsappStatus = 'pending' | 'linked' | 'revoked'

export interface WhatsappNumber {
  id: string | null
  number: string
  role: WhatsappRole
  status: WhatsappStatus
  gowaInstance: string | null
  gowaState: string | null
  gowaJid: string | null
  linkedAt: string | null
  revokedAt: string | null
  createdAt: string | null
}

export interface StartLinkResult {
  number: string
  role: WhatsappRole
  status: WhatsappStatus
  gowaInstance: string
  pairingCode: string
}

export interface EffectiveSender {
  sender: string | null
  source: 'registry' | 'app_settings' | 'none'
}

const WHATSAPP_URL = "https://api.pocketsoftware.dev/functions/v1/admin-whatsapp"

/**
 * Call the admin-whatsapp edge function with the current admin session.
 * Shares the same-origin Supabase session used by the citizen app.
 */
async function whatsappCall(
  action: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const { supabase } = await import("./secretsClient")
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error("Not signed in")
  const res = await fetch(WHATSAPP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, params }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return (await res.json()) as Record<string, unknown>
}

export async function listWhatsappNumbers(): Promise<WhatsappNumber[]> {
  const payload = await whatsappCall("list_numbers")
  const rows = (payload.data as { numbers?: WhatsappNumber[] })?.numbers ?? []
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    role: (row.role === 'otp' ? 'otp' : 'chat') as WhatsappRole,
    status: (['pending', 'linked', 'revoked'].includes(row.status)
      ? row.status
      : 'pending') as WhatsappStatus,
    gowaInstance: row.gowaInstance,
    gowaState: row.gowaState,
    gowaJid: row.gowaJid,
    linkedAt: row.linkedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }))
}

export async function startWhatsappLink(
  phone: string,
  role: WhatsappRole = 'chat'
): Promise<StartLinkResult> {
  const payload = await whatsappCall("start_link", { phone, role })
  const data = payload.data as StartLinkResult
  if (!data?.pairingCode) throw new Error("Pairing code not returned")
  return data
}

export async function confirmWhatsappLink(
  phone: string
): Promise<{ status: WhatsappStatus; jid?: string | null; loggedIn?: boolean }> {
  const payload = await whatsappCall("confirm_link", { phone })
  const data = payload.data as { status: WhatsappStatus; jid?: string | null; loggedIn?: boolean }
  return { status: data.status, jid: data.jid, loggedIn: data.loggedIn }
}

export async function setWhatsappRole(phone: string, role: WhatsappRole): Promise<void> {
  await whatsappCall("set_role", { phone, role })
}

export async function revokeWhatsappNumber(phone: string): Promise<void> {
  await whatsappCall("revoke", { phone })
}

export async function deleteWhatsappNumber(phone: string): Promise<void> {
  await whatsappCall("delete_number", { phone })
}

export async function getEffectiveSender(): Promise<EffectiveSender> {
  const payload = await whatsappCall("get_sender")
  const data = payload.data as EffectiveSender
  return {
    sender: data.sender,
    source: (data.source === 'registry' ? 'registry'
      : data.source === 'app_settings' ? 'app_settings' : 'none') as EffectiveSender['source'],
  }
}

// ---------------------------------------------------------------------------
// Institution logos (institution-logos storage bucket)
// ---------------------------------------------------------------------------

export interface LogoUploadResult {
  logoUrl: string
}

const LOGO_BUCKET = 'institution-logos'
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Upload an institution logo to the institution-logos bucket and return its
 * public URL. Overwrites the previous file for the same institution (files
 * are named <institutionId>.<ext>).
 */
export async function uploadInstitutionLogo(
  institutionId: string,
  file: File
): Promise<LogoUploadResult> {
  if (!LOGO_MIME_TYPES.includes(file.type)) {
    throw new Error("Logo must be a PNG, JPEG or WebP image")
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error("Logo must be smaller than 2 MB")
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${institutionId}.${ext}`
  const { supabase } = await import("./secretsClient")
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: true,
    })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
  return { logoUrl: data.publicUrl }
}
