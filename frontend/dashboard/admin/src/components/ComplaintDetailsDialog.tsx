import { useEffect, useState } from "react"
import { AlertCircle, Loader2, Mail, MapPin, Phone, RefreshCw, ShieldCheck } from "lucide-react"
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

export function ComplaintDetailsDialog({
  complaintId,
  onOpenChange,
}: {
  complaintId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [complaint, setComplaint] = useState<ComplaintDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!complaintId) {
      setComplaint(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setComplaint(null)

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
      } catch {
        if (!controller.signal.aborted) setError("We couldn't load this report. Check your connection and retry.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [complaintId, retry])

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
