import { useCallback, useEffect, useState } from "react"
import { AlertCircle, Loader2, MapPin, RefreshCw } from "lucide-react"
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet"
import type { LatLngBounds } from "leaflet"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/secretsClient"

type Bounds = { west: number; south: number; east: number; north: number }

type MapComplaint = {
  id: string
  tracking_no: string
  title: string
  status: string
  urgency: string
  category: string | null
  lat: number
  lng: number
  region: string | null
  council_area: string | null
  ward: string | null
  created_at: string
}

type MapResult = {
  ok: boolean
  error?: string
  scope?: "all" | "institution"
  total?: number
  returned?: number
  truncated?: boolean
  complaints?: MapComplaint[]
}

const INITIAL_CENTER: [number, number] = [13.45, -16.25]
const REPORT_LIMIT = 1200

function statusColor(status: string): string {
  if (["escalated", "rejected"].includes(status)) return "#c2474e"
  if (["in_progress", "assigned", "waiting_info", "forwarded"].includes(status)) return "#c08318"
  if (["resolved", "closed", "citizen_confirmation"].includes(status)) return "#617b82"
  return "#117c5a"
}

function MapViewportReporter({ onChange }: { onChange: (bounds: Bounds) => void }) {
  const map = useMap()

  useEffect(() => {
    const publishBounds = () => {
      const bounds: LatLngBounds = map.getBounds()
      onChange({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      })
    }
    publishBounds()
    map.on("moveend", publishBounds)
    return () => {
      map.off("moveend", publishBounds)
    }
  }, [map, onChange])

  return null
}

export function ComplaintsMap({
  onSelectComplaint,
  heightClass = "h-[360px] sm:h-[430px]",
}: {
  onSelectComplaint?: (complaintId: string) => void
  heightClass?: string
}) {
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [complaints, setComplaints] = useState<MapComplaint[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [scope, setScope] = useState<MapResult["scope"]>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  const handleBoundsChange = useCallback((next: Bounds) => {
    const rounded = {
      west: Number(next.west.toFixed(3)),
      south: Number(next.south.toFixed(3)),
      east: Number(next.east.toFixed(3)),
      north: Number(next.north.toFixed(3)),
    }
    setBounds((previous) =>
      previous && previous.west === rounded.west && previous.south === rounded.south &&
      previous.east === rounded.east && previous.north === rounded.north
        ? previous
        : rounded,
    )
  }, [])

  useEffect(() => {
    if (!bounds) return
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void (async () => {
        try {
          const { data, error: rpcError } = await supabase.rpc("fn_institution_map_complaints", {
            p_west: bounds.west,
            p_south: bounds.south,
            p_east: bounds.east,
            p_north: bounds.north,
            p_limit: REPORT_LIMIT,
          }).abortSignal(controller.signal)
          if (controller.signal.aborted) return
          if (rpcError) {
            setError("The report map could not refresh. Check your connection and try again.")
            return
          }
          const result = data as MapResult | null
          if (!result?.ok) {
            setError(result?.error === "not_authorized"
              ? "Your account is not authorized to view these report locations."
              : "The report map could not be loaded. Try again.")
            setComplaints([])
            setTotal(0)
            return
          }
          setComplaints(result.complaints ?? [])
          setTotal(result.total ?? 0)
          setTruncated(Boolean(result.truncated))
          setScope(result.scope)
        } catch {
          if (!controller.signal.aborted) {
            setError("The report map could not refresh. Check your connection and try again.")
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      })()
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [bounds, retry])

  return (
    <div>
      <div className={`relative isolate overflow-hidden rounded-xl border border-border bg-muted/30 ${heightClass}`}>
        <MapContainer
          center={INITIAL_CENTER}
          zoom={7}
          minZoom={6}
          maxZoom={18}
          scrollWheelZoom
          className="h-full w-full"
          aria-label="Map of complaint locations in The Gambia"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <MapViewportReporter onChange={handleBoundsChange} />
          {complaints.map((complaint) => (
            <CircleMarker
              key={complaint.id}
              center={[complaint.lat, complaint.lng]}
              radius={7}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: statusColor(complaint.status),
                fillOpacity: 0.92,
              }}
              eventHandlers={{
                click: () => onSelectComplaint?.(complaint.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -5]} opacity={1}>
                <span className="font-semibold">{complaint.tracking_no}</span>
                <span className="block max-w-48 truncate">{complaint.title}</span>
                <span className="text-xs">{complaint.category ?? "Report"} · {complaint.status.replaceAll("_", " ")}</span>
                {onSelectComplaint ? <span className="block text-xs font-medium text-emerald-800">Select marker for details</span> : null}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>

        {loading ? (
          <div className="absolute right-3 top-3 z-[500] inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating this area
          </div>
        ) : null}

        {!loading && !error && complaints.length === 0 ? (
          <div className="pointer-events-none absolute inset-x-4 top-4 z-[400] flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <MapPin className="h-4 w-4" aria-hidden="true" /> No location-tagged reports in this map area yet
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 px-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{total.toLocaleString()} location-tagged reports in view</span>
          {scope === "institution" ? <span>Limited to your institution</span> : null}
          {scope === "all" ? <span>All institutions</span> : null}
          {truncated ? <span className="text-amber-700">Showing the newest {complaints.length.toLocaleString()}; zoom in to see more</span> : null}
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-700" />New</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-600" />In progress</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-700" />Escalated</span>
        </div>
        {error ? (
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
