/**
 * /report — the citizen report wizard.
 *
 * Steps: pick the service → pick the problem → describe + photo + urgency →
 * where it is → review → submit through the real submit_commission RPC.
 * The user chooses the service and problem explicitly; those drive routing.
 */
import {
  Building2,
  Camera,
  Check,
  ChevronLeft,
  CircleHelp,
  Construction,
  Copy,
  Droplets,
  Factory,
  Flame,
  GraduationCap,
  HeartPulse,
  Lightbulb,
  LocateFixed,
  Loader2,
  Milestone,
  Scale,
  ShieldAlert,
  Signpost,
  Siren,
  Store,
  Trash,
  Trash2,
  Wind,
  Waves,
  HandCoins,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import GamCivMark from '@/components/GamCivMark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { DiscardReportDialog, SubmitReportDialog } from '@/components/ConfirmDialogs'
import { rememberTracking } from '@/pages/MyReports'
import { handleAuthExpired, isAuthError, isNetworkError, supabase } from '@/lib/supabase'
import {
  COUNCIL_AREAS,
  councilForLatLng,
  fetchInstitutions,
  type CategoryInfo,
  type InstitutionInfo,
} from '@/lib/gamciv'

const SENSITIVE_NOTE = 'These reports are reviewed by the GamCiv Central Desk first.'

const CATEGORY_ICON_COMPONENTS: Record<string, LucideIcon> = {
  water_supply: Droplets,
  electricity: Lightbulb,
  sewerage: Waves,
  waste_collection: Trash2,
  illegal_dumping: Factory,
  pollution: Wind,
  public_health: HeartPulse,
  streetlight: Lightbulb,
  local_roads: Construction,
  national_roads: Signpost,
  traffic_signs: Milestone,
  markets: Store,
  education: GraduationCap,
  crime_report: ShieldAlert,
  police_misconduct: Scale,
  abuse_of_power: HandCoins,
  corruption_report: HandCoins,
  emergency_fire: Flame,
  emergency_police: Siren,
  other: CircleHelp,
}

type LocationState = {
  mode: 'none' | 'gps' | 'area'
  lat: number | null
  lng: number | null
  area: string
  landmark: string
}

const EMPTY_LOCATION: LocationState = {
  mode: 'none',
  lat: null,
  lng: null,
  area: '',
  landmark: '',
}

type SubmitResult = {
  tracking_no: string
  complaint_id: string
  institution: string
  institution_name: string
}

const STEP_LABELS = ['Service', 'Problem', 'Describe', 'Location', 'Review']

export default function Report() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const prevStepRef = useRef(0)
  const stepDirection = step >= prevStepRef.current ? 1 : -1
  prevStepRef.current = step

  useEffect(() => {
    document.title = 'New report · GamCiv'
  }, [])
  const [institutions, setInstitutions] = useState<InstitutionInfo[] | null>(null)
  const [categories, setCategories] = useState<CategoryInfo[] | null>(null)
  const [instId, setInstId] = useState<string | null>(null)
  const [catId, setCatId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState<'normal' | 'high'>('normal')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [location, setLocation] = useState<LocationState>(EMPTY_LOCATION)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'ok' | 'error'>('idle')
  const [copied, setCopied] = useState(false)
  const [centralId, setCentralId] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)

  // A report is "dirty" once the user has entered anything worth keeping.
  const isDirty =
    step > 0 &&
    step < 5 &&
    (title.trim().length >= 3 ||
      description.trim().length >= 10 ||
      !!photoFile ||
      !!location.area ||
      location.mode === 'gps' ||
      !!catId)

  /** Guarded exit: ask before throwing away a half-filled report. */
  function requestExit() {
    if (isDirty) setDiscardOpen(true)
    else navigate('/home')
  }

  // AppShell's focus-mode Close button broadcasts this event; guard it here.
  useEffect(() => {
    const onExit = () => requestExit()
    window.addEventListener('gamciv:exit-report', onExit)
    return () => window.removeEventListener('gamciv:exit-report', onExit)
  })

  // Idempotency key for the current submit attempt; null once a report is
  // confirmed created. Survives failed retries within one fill-out.
  const sentExternalIdRef = useRef<string | null>(null)

  const institution = useMemo(
    () => institutions?.find((i) => i.id === instId) ?? null,
    [institutions, instId],
  )
  const category = useMemo(
    () => categories?.find((c) => c.id === catId) ?? null,
    [categories, catId],
  )
  const visibleCategories = useMemo(() => {
    if (!categories || !instId) return []
    const inst = institutions?.find((i) => i.id === instId)
    if (!inst) return []
    if (inst.code === 'CENTRAL') {
      return categories.filter(
        (c) => c.default_institution_id === null || c.default_institution_id === centralId,
      )
    }
    return categories.filter((c) => c.default_institution_id === instId)
  }, [categories, instId, institutions, centralId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [insts, cats] = await Promise.all([fetchInstitutions(), fetchCategories()])
      if (!alive) return
      setCentralId(insts.find((i) => i.code === 'CENTRAL')?.id ?? '')
      setInstitutions(insts)
      setCategories(cats)
    })()
    return () => {
      alive = false
    }
  }, [])

  async function fetchCategories(): Promise<CategoryInfo[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('id, slug, name, default_institution_id, is_sensitive, is_emergency, deadline_hours')
      .order('name')
    if (error || !data) {
      toast.error('Could not load the problem list. Check your connection and try again.')
      console.error('categories fetch failed:', error?.message)
      return []
    }
    return data as unknown as CategoryInfo[]
  }

  const canNext = useMemo(() => {
    switch (step) {
      case 0:
        return !!instId
      case 1:
        return !!catId
      case 2:
        return title.trim().length >= 3 && description.trim().length >= 10
      case 3:
        return location.mode === 'gps' || !!location.area
      default:
        return true
    }
  }, [step, instId, catId, title, description, location])

  function goNext() {
    if (step === 3 && location.mode === 'gps' && location.lat != null && location.lng != null) {
      const area = councilForLatLng(location.lat, location.lng)
      if (area) setLocation((l) => ({ ...l, area }))
    }
    setStep((s) => Math.min(4, s + 1))
    window.scrollTo(0, 0)
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1))
    window.scrollTo(0, 0)
  }

  function pickInstitution(id: string) {
    if (instId !== id) {
      setInstId(id)
      setCatId(null)
    }
    setStep(1)
    window.scrollTo(0, 0)
  }

  function pickCategory(id: string) {
    setCatId(id)
    setStep(2)
    window.scrollTo(0, 0)
  }

  function handlePhoto(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image (JPG or PNG).')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Photo must be under 10 MB.')
      return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null)
    setPhotoPreview(null)
  }

  async function doGps() {
    if (!('geolocation' in navigator)) {
      setGpsState('error')
      toast.error('Your browser cannot share location. Pick your area below instead.')
      return
    }
    setGpsState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState('ok')
        setLocation((l) => ({
          ...l,
          mode: 'gps',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }))
      },
      () => {
        setGpsState('error')
        toast.error('Location permission denied — choose your area manually below.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  async function submit() {
    if (!institution || !category) return
    if (!navigator.onLine) {
      toast.error("You're offline. Reconnect and try again — your report isn't sent yet.")
      return
    }
    setSubmitting(true)
    try {
      // Idempotency key: one per fill-out of the form. If the request is lost
      // in transit and the person taps Send again, the backend returns the
      // already-created report instead of filing a duplicate.
      if (!sentExternalIdRef.current) {
        const uuid =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        // Uppercase on purpose: the backend stores external_id uppercased
        // (fn_norm_external_id trigger) and its duplicate check compares the
        // raw parameter, so a lowercase retry would 409 instead of deduping.
        sentExternalIdRef.current = `web-${uuid}`.toUpperCase()
      }
      const params: Record<string, unknown> = {
        p_title: title.trim(),
        p_description: description.trim(),
        p_category_hint: category.slug,
        p_urgency_hint: urgency,
        p_channel: 'web',
        p_is_anonymous: false,
        // The user explicitly chose the service and problem in this wizard,
        // so the backend can route at full confidence.
        p_confidence: 1.0,
        p_external_id: sentExternalIdRef.current,
      }
      if (location.mode === 'gps' && location.lat != null && location.lng != null) {
        params.p_lat = location.lat
        params.p_lng = location.lng
      }
      if (location.area) {
        params.p_council_area = location.area
        params.p_region = regionForArea(location.area)
      }
      if (location.landmark.trim()) params.p_ward = location.landmark.trim()

      const { data, error } = await supabase.rpc('submit_complaint', params)
      if (error || !data) {
        console.error('submit_complaint failed:', error?.message)
        if (isAuthError(error)) {
          // Expired session: clear it so the next navigation asks for login.
          toast.error('Your session has expired. Please sign in again.')
          await handleAuthExpired()
          return
        }
        toast.error(
          isNetworkError(error)
            ? "Network problem — the report may not have been sent. Check your connection and try Send again; you won't get duplicates."
            : friendlySubmitError(error),
        )
        return
      }

      const res = data as SubmitResult
      if (photoFile) {
        const path = await uploadPhoto(res.complaint_id, photoFile)
        if (path) {
          // Citizens cannot update complaint rows (RLS), so the path is attached
          // through a SECURITY DEFINER RPC that checks ownership.
          const { error: attachError } = await supabase.rpc('attach_photo', {
            p_complaint_id: res.complaint_id,
            p_path: path,
          })
          if (attachError) {
            console.error('attach_photo failed:', attachError.message)
            toast.warning('Report filed, but the photo could not be attached.')
          }
        } else {
          toast.warning('Report filed, but the photo upload failed. You can still track it.')
        }
      }

      // Report is confirmed on screen — the next submission is a new report
      // and must get a fresh idempotency key.
      sentExternalIdRef.current = null
      rememberTracking(res.tracking_no)
      setResult({ ...res, institution_name: institution.name })
      setStep(5)
      window.scrollTo(0, 0)
    } catch (err) {
      console.error('submit threw:', err)
      toast.error('Something went wrong while sending your report. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function uploadPhoto(complaintId: string, file: File): Promise<string | null> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${complaintId}/${Date.now()}-${safe}`
    const { error } = await supabase.storage
      .from('complaint-photos')
      .upload(path, file, { cacheControl: '3600', upsert: false })
    if (error) {
      console.error('photo upload failed:', error.message)
      return null
    }
    return path
  }

  async function copyTracking() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.tracking_no)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the code and copy it manually.')
    }
  }

  const stepIndex = Math.min(step, 4)

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 min-[1024px]:max-w-[1200px] md:px-6">
      <main className="w-full">
        <div className="grid grid-cols-1 gap-8 min-[1024px]:grid-cols-12">
        <div className="min-[1024px]:col-span-7">
        {step < 5 && (
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">
                Step {stepIndex + 1} of {STEP_LABELS.length}: {STEP_LABELS[stepIndex]}
              </span>
              <span className="text-muted-foreground tabular">
                {Math.round(((stepIndex + 1) / STEP_LABELS.length) * 100)}%
              </span>
            </div>
            <Progress className="h-1.5" value={((stepIndex + 1) / STEP_LABELS.length) * 100} />
            <div className="mt-1.5 flex justify-between text-[11px]" aria-hidden="true">
              {STEP_LABELS.map((label, i) => (
                <span
                  key={label}
                  className={
                    i === stepIndex ? 'font-semibold text-primary' : 'text-muted-foreground'
                  }
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
        {/* STEP 0: service picker */}
        {step === 0 && (
          <motion.section
            key="step-0"
            initial={{ opacity: 0, x: 32 * stepDirection }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * stepDirection }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Who should handle it?
            </h1>
            <p className="mt-2 text-muted-foreground">
              Pick the service your report is for. This decides where it goes — you choose,
              we deliver.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {institutions === null
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
                      <div className="h-12 w-12 animate-pulse rounded-md bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  ))
                : institutions.map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => pickInstitution(inst.id)}
                      className="group flex items-start gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:shadow-sm"
                    >
                      {inst.logo ? (
                        <img
                          src={inst.logo}
                          alt=""
                          className="h-12 w-12 rounded-md border border-border/60 object-contain"
                        />
                      ) : (
                        <GamCivMark className="h-12 w-12" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-semibold leading-tight">{inst.name}</span>
                        <span className="mt-1 block text-sm text-muted-foreground">{inst.blurb}</span>
                      </span>
                    </button>
                  ))}
            </div>
          </motion.section>
        )}

        {/* STEP 1: category picker */}
        {step === 1 && (
          <motion.section
            key="step-1"
            initial={{ opacity: 0, x: 32 * stepDirection }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * stepDirection }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              What kind of problem?
            </h1>
            <p className="mt-2 text-muted-foreground">
              Reporting to <span className="font-semibold text-foreground">{institution?.name}</span>.
              Choose the type that fits best.
            </p>
            {category?.is_sensitive && (
              <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                {SENSITIVE_NOTE}
              </div>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {visibleCategories.map((cat) => {
                const Icon = CATEGORY_ICON_COMPONENTS[cat.slug] ?? CircleHelp
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => pickCategory(cat.id)}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:shadow-sm"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                      <Icon className="h-5 w-5 text-primary" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold leading-tight">{cat.name}</span>
                      {cat.is_sensitive && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Reviewed by the Central Desk
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-6">
              <Button variant="ghost" onClick={goBack}>
                <ChevronLeft /> Back
              </Button>
            </div>
          </motion.section>
        )}

        {/* STEP 2: describe */}
        {step === 2 && (
          <motion.section
            key="step-2"
            initial={{ opacity: 0, x: 32 * stepDirection }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * stepDirection }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Describe the problem
            </h1>
            <p className="mt-2 text-muted-foreground">
              A short title and what you saw. A photo helps the team fix it faster.
            </p>
            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Broken street light near the market"
                  maxLength={120}
                />
                {title.length > 0 && title.trim().length < 3 && (
                  <p className="text-sm text-destructive">Title must be at least 3 characters.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">What happened?</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the problem and where exactly it is. At least 10 characters."
                  rows={5}
                />
                {description.length > 0 && description.trim().length < 10 && (
                  <p className="text-sm text-destructive">
                    Description must be at least 10 characters.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Photo (optional)</Label>
                {photoPreview ? (
                  <div className="flex items-start gap-3">
                    <img
                      src={photoPreview}
                      alt="Report photo preview"
                      className="h-24 w-24 rounded-lg border border-border object-cover"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={clearPhoto}>
                      <Trash /> Remove
                    </Button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-card p-4 hover:bg-secondary/60">
                    <Camera className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">Add a photo</span>
                    <span className="text-xs text-muted-foreground">JPG or PNG, up to 10 MB</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => handlePhoto(e.target.files?.[0])}
                    />
                  </label>
                )}
              </div>
              <div className="space-y-2">
                <Label>How urgent is it?</Label>
                <button
                  type="button"
                  onClick={() => setUrgency((u) => (u === 'high' ? 'normal' : 'high'))}
                  aria-pressed={urgency === 'high'}
                  className={
                    'flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ' +
                    (urgency === 'high'
                      ? 'border-destructive/60 bg-destructive/5'
                      : 'border-border bg-card hover:bg-secondary/60')
                  }
                >
                  <span
                    className={
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ' +
                      (urgency === 'high' ? 'border-destructive bg-destructive' : 'border-border')
                    }
                  >
                    {urgency === 'high' && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span>
                    <span className="block font-medium">This is urgent — risk to health or safety</span>
                    <span className="block text-sm text-muted-foreground">
                      Fires, live wires, contaminated water, unsafe structures.
                    </span>
                  </span>
                </button>
              </div>
            </div>
            <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between border-t border-clay-line bg-background/95 p-4 backdrop-blur md:-mx-6">
              <Button variant="ghost" className="h-11" onClick={goBack}>
                <ChevronLeft /> Back
              </Button>
              <Button className="h-11" onClick={goNext} disabled={!canNext}>
                Next
              </Button>
            </div>
          </motion.section>
        )}

        {/* STEP 3: location */}
        {step === 3 && (
          <motion.section
            key="step-3"
            initial={{ opacity: 0, x: 32 * stepDirection }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * stepDirection }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Where is it?
            </h1>
            <p className="mt-2 text-muted-foreground">
              Your location helps the team find the problem. Use GPS or pick your area.
            </p>
            <div className="mt-6 space-y-5">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">Use my location</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {gpsState === 'ok' && location.lat != null
                        ? `Found: ${location.lat.toFixed(5)}, ${location.lng?.toFixed(5)}`
                        : 'Your browser will ask for permission.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={doGps}
                    disabled={gpsState === 'locating'}
                  >
                    {gpsState === 'locating' ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <LocateFixed />
                    )}
                    {gpsState === 'locating' ? 'Locating…' : 'Detect'}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Council area</Label>
                <Select
                  value={location.area || undefined}
                  onValueChange={(v) => setLocation((l) => ({ ...l, mode: 'area', area: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick your area" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNCIL_AREAS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required if you did not use GPS.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="landmark">Nearest landmark (optional)</Label>
                <Input
                  id="landmark"
                  value={location.landmark}
                  onChange={(e) => setLocation((l) => ({ ...l, landmark: e.target.value }))}
                  placeholder="e.g. opposite the mosque, Westfield junction"
                />
              </div>
            </div>
            <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between border-t border-clay-line bg-background/95 p-4 backdrop-blur md:-mx-6">
              <Button variant="ghost" className="h-11" onClick={goBack}>
                <ChevronLeft /> Back
              </Button>
              <Button className="h-11" onClick={goNext} disabled={!canNext}>
                Next
              </Button>
            </div>
          </motion.section>
        )}

        {/* STEP 4: review */}
        {step === 4 && (
          <motion.section
            key="step-4"
            initial={{ opacity: 0, x: 32 * stepDirection }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * stepDirection }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Check and send
            </h1>
            <div className="mt-6 space-y-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  {institution?.logo ? (
                    <img src={institution.logo} alt="" className="h-10 w-10 rounded-md object-contain" />
                  ) : (
                    <GamCivMark className="h-10 w-10" />
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">This will be sent to</p>
                    <p className="font-semibold leading-tight">{institution?.name}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">Problem</p>
                <p className="font-semibold">{category?.name}</p>
                <p className="mt-2 text-sm text-muted-foreground">Title</p>
                <p className="font-medium">{title.trim()}</p>
                <p className="mt-2 text-sm text-muted-foreground">Description</p>
                <p className="text-sm">{description.trim()}</p>
                {photoPreview && (
                  <img
                    src={photoPreview}
                    alt="Attached photo"
                    className="mt-3 h-20 w-20 rounded-md border border-border object-cover"
                  />
                )}
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">Location</p>
                <p className="font-medium">
                  {location.mode === 'gps' && location.lat != null
                    ? `${location.lat.toFixed(5)}, ${location.lng?.toFixed(5)}`
                    : COUNCIL_AREAS.find((a) => a.value === location.area)?.label ?? '—'}
                  {location.area && location.mode === 'gps'
                    ? ` · ${COUNCIL_AREAS.find((a) => a.value === location.area)?.label}`
                    : ''}
                </p>
                {location.landmark.trim() && (
                  <p className="mt-1 text-sm text-muted-foreground">{location.landmark.trim()}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <Badge variant={urgency === 'high' ? 'destructive' : 'secondary'}>
                    {urgency === 'high' ? 'Urgent' : 'Normal urgency'}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between border-t border-clay-line bg-background/95 p-4 backdrop-blur md:-mx-6">
              <Button variant="ghost" className="h-11" onClick={goBack} disabled={submitting}>
                <ChevronLeft /> Back
              </Button>
              <Button className="h-11" onClick={() => setConfirmOpen(true)} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="animate-spin" /> Sending…
                  </>
                ) : (
                  'Send report'
                )}
              </Button>
            </div>
          </motion.section>
        )}

        {/* STEP 5: success — the ONE gold moment (spec G1) */}
        {step === 5 && result && (
          <motion.section
            key="step-success"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-xl text-center min-[1024px]:max-w-[560px]"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Report submitted
            </h1>
            <p className="mt-2 text-muted-foreground">
              Your report goes to {result.institution_name}. Keep this tracking number:
            </p>
            <div className="mt-6 rounded-xl bg-gold-tint p-4">
              <p className="font-display text-[28px] font-bold leading-tight tracking-wide text-gold-deep tabular">
                {result.tracking_no}
              </p>
              <p className="mt-1 text-xs text-gold-ink">
                Write it down or screenshot it — you will need it to follow your report.
              </p>
            </div>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" className="h-11" onClick={copyTracking}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button asChild className="h-11">
                <Link to={`/track?ref=${result.tracking_no}`}>Track it</Link>
              </Button>
            </div>
            <p className="mt-6">
              <Link to="/report" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                File another report
              </Link>
            </p>
          </motion.section>
        )}
        </AnimatePresence>
        </div>

        {/* Desktop: live summary panel (spec 3b') */}
        {step < 5 && (
          <aside className="hidden min-[1024px]:block min-[1024px]:col-span-5">
            <div className="sticky top-24 rounded-xl border border-border bg-card p-5">
              <p className="font-display text-base font-bold tracking-tight">Summary</p>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  {institution ? (
                    institution.logo ? (
                      <img src={institution.logo} alt="" className="h-8 w-8 rounded object-contain" />
                    ) : (
                      <GamCivMark className="h-8 w-8" />
                    )
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-secondary">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Service</dt>
                    <dd className="truncate font-medium">{institution?.name ?? 'Not set yet'}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Problem</dt>
                  <dd className="font-medium">{category?.name ?? 'Not set yet'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Title</dt>
                  <dd className="font-medium">{title.trim() || 'Not set yet'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Urgency</dt>
                  <dd>
                    <Badge variant={urgency === 'high' ? 'destructive' : 'secondary'}>
                      {urgency === 'high' ? 'Urgent' : 'Normal'}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Location</dt>
                  <dd className="font-medium">
                    {location.mode === 'gps' && location.lat != null
                      ? `${location.lat.toFixed(5)}, ${location.lng?.toFixed(5)}`
                      : COUNCIL_AREAS.find((a) => a.value === location.area)?.label ?? 'Not set yet'}
                  </dd>
                </div>
                {photoPreview && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Photo</dt>
                    <dd>
                      <img src={photoPreview} alt="Attached photo preview" className="mt-1 h-16 w-16 rounded-md border border-border object-cover" />
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </aside>
        )}
        </div>
      </main>

      <DiscardReportDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          setDiscardOpen(false)
          navigate('/home')
        }}
      />

      <SubmitReportDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!submitting) setConfirmOpen(open)
        }}
        onConfirm={submit}
        busy={submitting}
        summary={
          institution
            ? `Send "${title.trim()}" to ${institution.name}${
                location.area
                  ? ` (${COUNCIL_AREAS.find((a) => a.value === location.area)?.label ?? location.area})`
                  : ''
              }?`
            : null
        }
      />
    </div>
  )
}

function regionForArea(area: string): string {
  switch (area) {
    case 'banjul':
      return 'Banjul'
    case 'brikama':
      return 'West Coast Region'
    default:
      return 'Greater Banjul'
  }
}

function friendlySubmitError(err: { message?: string } | null): string {
  const msg = err?.message ?? ''
  if (msg.includes('title_required_min_3_chars')) return 'Give the report a short title first.'
  if (msg.includes('description_required_min_10'))
    return 'Describe the problem in a little more detail (at least 10 characters).'
  if (msg.includes('category_required') || msg.includes('unknown_category'))
    return 'Choose a problem type and try again.'
  return 'Could not file the report. Check your connection and try again.'
}