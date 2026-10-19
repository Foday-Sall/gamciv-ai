import { Building } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"

// The platform has a single administrator. Future maintenance-window pages
// land here so unknown routes never render blank.
export function NotScheduledPage() {
  return (
    <div>
      <PageHeader
        title="Not scheduled"
        description="This area is not part of the administrator scope yet."
      />
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6 text-muted-foreground">
        <Building className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
        <p className="text-sm">No tools are published for this route.</p>
      </div>
    </div>
  )
}
