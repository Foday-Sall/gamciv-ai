import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Mail, MapPin, Phone, Play, RefreshCw, ShieldCheck, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/secretsClient"

type ComplaintDetail = {
  id: string
  tracking_no: string
  title: string
  description: string
  status: string
  urgency: string
  category: string | null
  lat: number | null
  lng: number | null
  region: string | null
  council_area: string | null
  ward: string | null
  created_at: string
  updated_at: string
  is_anonymous: boolean
  photo_url: string | null
  resolution_photo_url: string | null
  resolution_note: string | null
  contact: { name: string | null; phone: string | null; email: string | null } | null
}

type DetailResult = { ok: boolean; error?: string; complaint?: ComplaintDetail }

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Date unavailable"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

async function signedEvidenceUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  const { data, error } = await supabase.storage
    .from("complaint-photos")
    .createSignedUrl(path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

export function ComplaintDetailsDialog({
  complaintId,
  onOpenChange,
  onStatusUpdated,
  refreshSignal = 0,
}: {
  complaintId: string | null
  onOpenChange: (open: boolean) => void
  onStatusUpdated?: () => void
  refreshSignal?: number
}) {
  const [complaint, setComplaint] = useState<ComplaintDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [citizenPhoto, setCitizenPhoto] = useState<string | null>(null)
  const [resolutionPhoto, setResolutionPhoto] = useState<string | null>(null)
  const [resolutionNote, setResolutionNote] = useState("")
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [savingResolution, setSavingResolution] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!complaintId) {
      setComplaint(null)
      setError(null)
      setCitizenPhoto(null)
      setResolutionPhoto(null)
      setResolutionNote("")
      setProofFile(null)
      setStatusError(null)
      setActionError(null)
      setActionSuccess(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setComplaint(null)
    setCitizenPhoto(null)
    setResolutionPhoto(null)

    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "fn_officer_complaint_detail",
          { p_complaint_id: complaintId },
        ).abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (rpcError) {
          setError("We couldn't load this report. Check your connection and retry.")
          return
        }
        const result = data as DetailResult | null
        if (!result?.ok || !result.complaint) {
          setError(result?.error === "not_found"
            ? "This report is unavailable or outside your institution's access."
            : "Your account is not authorized to view this report.")
          return
        }
        setComplaint(result.complaint)
        const [citizenUrl, resolutionUrl] = await Promise.all([
          signedEvidenceUrl(result.complaint.photo_url).catch((signError: unknown) => {
            console.warn("Citizen photo could not be signed:", signError)
            return null
          }),
          signedEvidenceUrl(result.complaint.resolution_photo_url).catch((signError: unknown) => {
            console.warn("Resolution photo could not be signed:", signError)
            return null
          }),
        ])
        if (!controller.signal.aborted) {
          setCitizenPhoto(citizenUrl)
          setResolutionPhoto(resolutionUrl)
        }
      } catch {
        if (!controller.signal.aborted) setError("We couldn't load this report. Check your connection and retry.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [complaintId, retry, refreshSignal])

  const contact = complaint?.is_anonymous ? null : complaint?.contact
  const phone = contact?.phone?.trim() || null
  const email = contact?.email?.trim() || null
  const locationParts = [complaint?.ward, complaint?.council_area, complaint?.region, "The Gambia"]
    .filter((part): part is string => Boolean(part?.trim()))
  const lat = complaint?.lat == null ? null : Number(complaint.lat)
  const lng = complaint?.lng == null ? null : Number(complaint.lng)
  const mapUrl = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
    : null
  const canAcceptReport = Boolean(complaint && ["submitted", "received", "escalated"].includes(complaint.status))
  const canStartWork = Boolean(complaint && ["assigned", "waiting_info"].includes(complaint.status))
  const canReportResolution = Boolean(complaint && ["assigned", "in_progress", "waiting_info"].includes(complaint.status))

  async function updateWorkStatus(action: "accept" | "in_progress") {
    if (!complaint || savingStatus || savingResolution) return
    setSavingStatus(true)
    setStatusError(null)
    setActionError(null)
    setActionSuccess(null)
    try {
      const { data, error: rpcError } = action === "accept"
        ? await supabase.rpc("fn_officer_accept", { p_complaint_id: complaint.id })
        : await supabase.rpc("fn_officer_set_status", {
            p_complaint_id: complaint.id,
            p_status: "in_progress",
            p_citizen_message: "An officer has started work on your report.",
          })
      if (rpcError) throw rpcError
      if (data !== true) {
        setStatusError(action === "accept"
          ? "This report could not be accepted. Refresh it and confirm it is still available to your institution."
          : "This report could not be marked in progress. Refresh it and confirm it is still assigned to your institution.")
        return
      }
      onStatusUpdated?.()
      setRetry((value) => value + 1)
    } catch {
      setStatusError("The report status could not be updated. Check your connection and try again.")
    } finally {
      setSavingStatus(false)
    }
  }

  async function reportResolution() {
    if (!complaint || savingResolution || savingStatus) return
    const note = resolutionNote.trim()
    if (note.length < 5) {
      setActionError("Add a short resolution note of at least 5 characters.")
      return
    }
    if (proofFile && (!['image/jpeg', 'image/png', 'image/webp'].includes(proofFile.type) || proofFile.size > 10 * 1024 * 1024)) {
      setActionError("Choose a JPG, PNG, or WebP image up to 10 MB.")
      return
    }

    setSavingResolution(true)
    setActionError(null)
    setActionSuccess(null)
    let uploadedPath: string | null = null
    try {
      if (proofFile) {
        const ext = proofFile.type === "image/png" ? "png" : proofFile.type === "image/webp" ? "webp" : "jpg"
        const objectId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        uploadedPath = `${complaint.id}/resolution-${objectId}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from("complaint-photos")
          .upload(uploadedPath, proofFile, {
            cacheControl: "3600",
            contentType: proofFile.type,
            upsert: false,
          })
        if (uploadError) throw new Error(uploadError.message)
      }

      const { data, error: rpcError } = await supabase.rpc("fn_officer_report_resolution", {
        p_complaint_id: complaint.id,
        p_citizen_message: note,
        p_resolution_photo_url: uploadedPath,
      })
      if (rpcError) throw new Error(rpcError.message)
      if (data !== true) {
        if (uploadedPath) await supabase.storage.from("complaint-photos").remove([uploadedPath])
        setActionError("This report could not be marked resolved. Refresh the report and check that it is still assigned to your institution.")
        return
      }

      setActionSuccess("Fix reported. The citizen can confirm the resolution or reopen the report.")
      setResolutionNote("")
      setProofFile(null)
      onStatusUpdated?.()
      setRetry((value) => value + 1)
    } catch (actionFailure) {
      if (uploadedPath) {
        await supabase.storage.from("complaint-photos").remove([uploadedPath]).catch(() => undefined)
      }
      setActionError(actionFailure instanceof Error
        ? `The resolution could not be saved: ${actionFailure.message}`
        : "The resolution could not be saved. Check your connection and retry.")
    } finally {
      setSavingResolution(false)
    }
  }

  return (
    <Dialog open={Boolean(complaintId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
            <div className="min-w-0">
              <DialogTitle className="font-display text-xl">Report details</DialogTitle>
              <DialogDescription className="mt-1 font-mono text-xs">
                {complaint?.tracking_no ?? "Secure report record"}
              </DialogDescription>
            </div>
            {complaint ? <Badge variant="secondary">{formatLabel(complaint.status)}</Badge> : null}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading report details…
          </div>
        ) : error ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
            <p className="max-w-md text-sm text-muted-foreground" role="alert">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : complaint ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{complaint.category ?? "Uncategorized"}</Badge>
              <Badge variant={complaint.urgency === "critical" || complaint.urgency === "high" ? "danger" : "secondary"}>
                {formatLabel(complaint.urgency || "normal")} priority
              </Badge>
              <span className="text-xs text-muted-foreground">Received {formatDate(complaint.created_at)}</span>
            </div>

            <section aria-labelledby="detail-description-heading">
              <h3 id="detail-description-heading" className="text-sm font-semibold">{complaint.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{complaint.description}</p>
            </section>

            <section className="grid gap-4 sm:grid-cols-2" aria-label="Report evidence">
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Citizen evidence</h3>
                {citizenPhoto ? (
                  <a href={citizenPhoto} target="_blank" rel="noreferrer" className="mt-3 block">
                    <img src={citizenPhoto} alt={`Photo submitted with report ${complaint.tracking_no}`} className="max-h-72 w-full rounded-lg object-contain" />
                    <span className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline">Open full-size photo</span>
                  </a>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{complaint.photo_url ? "The submitted photo is unavailable right now." : "No photo was submitted with this report."}</p>
                )}
              </div>
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Resolution evidence</h3>
                {resolutionPhoto ? (
                  <a href={resolutionPhoto} target="_blank" rel="noreferrer" className="mt-3 block">
                    <img src={resolutionPhoto} alt={`Resolution evidence for report ${complaint.tracking_no}`} className="max-h-72 w-full rounded-lg object-contain" />
                    <span className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline">Open full-size photo</span>
                  </a>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{complaint.resolution_photo_url ? "Resolution photo unavailable." : "No resolution photo has been added."}</p>
                )}
                {complaint.resolution_note ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{complaint.resolution_note}</p> : null}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-muted/20 p-4" aria-labelledby="detail-location-heading">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 id="detail-location-heading" className="text-sm font-semibold">Reported location</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {locationParts.length ? locationParts.join(", ") : "No area was provided"}
                  </p>
                  {mapUrl ? (
                    <a href={mapUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Open location in OpenStreetMap
                    </a>
                  ) : null}
                </div>
              </div>
            </section>

            {canAcceptReport || canStartWork ? (
              <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby="manage-report-heading">
                <h3 id="manage-report-heading" className="text-sm font-semibold">Update report status</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {canAcceptReport
                    ? "Accept this report to assign it to your institution and unlock staff resolution actions."
                    : "Start work to update the citizen and track active repairs."}
                </p>
                {statusError ? <p className="mt-3 text-sm text-destructive" role="alert">{statusError}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {canAcceptReport ? (
                    <Button type="button" onClick={() => void updateWorkStatus("accept")} disabled={savingStatus || savingResolution}>
                      {savingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
                      {savingStatus ? "Accepting report" : "Accept report"}
                    </Button>
                  ) : null}
                  {canStartWork ? (
                    <Button type="button" onClick={() => void updateWorkStatus("in_progress")} disabled={savingStatus || savingResolution}>
                      {savingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="mr-2 h-4 w-4" aria-hidden="true" />}
                      {savingStatus ? "Updating status" : "Mark in progress"}
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {canReportResolution ? (
              <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby="resolve-report-heading">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 id="resolve-report-heading" className="text-sm font-semibold">Mark resolved</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Report the fix to the citizen. They can confirm it or reopen the report.</p>
                <label htmlFor="resolution-note" className="mt-4 block text-sm font-medium">Resolution note</label>
                <textarea
                  id="resolution-note"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  maxLength={1200}
                  rows={3}
                  placeholder="Describe the repair or action taken"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label htmlFor="resolution-proof" className="mt-4 block text-sm font-medium">Resolution photo (optional)</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Input
                    id="resolution-proof"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="max-w-sm"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      setProofFile(file)
                      setActionError(null)
                    }}
                  />
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ImagePlus className="h-4 w-4" aria-hidden="true" /> JPG, PNG, or WebP, up to 10 MB</span>
                </div>
                {proofFile ? <p className="mt-2 text-xs text-muted-foreground">Selected: {proofFile.name}</p> : null}
                {actionError ? <p className="mt-3 text-sm text-destructive" role="alert">{actionError}</p> : null}
                {actionSuccess ? <p className="mt-3 text-sm text-primary" role="status">{actionSuccess}</p> : null}
                <Button type="button" className="mt-4" onClick={() => void reportResolution()} disabled={savingResolution || resolutionNote.trim().length < 5}>
                  {savingResolution ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {savingResolution ? "Saving resolution" : "Mark resolved"}
                </Button>
              </section>
            ) : null}

            <section className="rounded-xl border border-border p-4" aria-labelledby="reporter-contact-heading">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 id="reporter-contact-heading" className="text-sm font-semibold">Reporter contact</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Visible only to authorized staff for this institution.</p>
              {complaint.is_anonymous ? (
                <p className="mt-4 text-sm text-muted-foreground">This report was submitted anonymously. No contact details are available.</p>
              ) : contact && (contact.name || phone || email) ? (
                <>
                  <p className="mt-4 font-medium">{contact.name || "Name not provided"}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4" aria-hidden="true" />{phone ?? "Phone not provided"}</span>
                    <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" aria-hidden="true" />{email ?? "Email not provided"}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {phone ? (
                      <Button asChild variant="outline">
                        <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}><Phone className="mr-2 h-4 w-4" aria-hidden="true" /> Call reporter</a>
                      </Button>
                    ) : null}
                    {email ? (
                      <Button asChild variant="outline">
                        <a href={`mailto:${email}`}><Mail className="mr-2 h-4 w-4" aria-hidden="true" /> Email reporter</a>
                      </Button>
                    ) : null}
                    {!phone && !email ? <p className="text-sm text-muted-foreground">No phone number or email was provided.</p> : null}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">The reporter did not provide contact details.</p>
              )}
            </section>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>Close details</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
