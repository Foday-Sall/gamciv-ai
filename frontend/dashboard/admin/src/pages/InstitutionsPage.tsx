import { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { getInstitutions, type Institution } from "@/lib/adminApi"
import InstitutionDialog from "@/pages/institutions/InstitutionDialog"
import InstitutionDrawer from "@/pages/institutions/InstitutionDrawer"
import InstitutionsTable from "@/pages/institutions/InstitutionsTable"

/** Institutions admin: list of agencies, add-institution dialog, details drawer. */
export default function InstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<Institution | null>(null)

  useEffect(() => {
    let cancelled = false
    getInstitutions().then((data) => {
      if (!cancelled) setInstitutions(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const totalOpen = useMemo(
    () => (institutions ?? []).reduce((sum, entry) => sum + entry.openComplaints, 0),
    [institutions]
  )

  return (
    <div>
      <PageHeader
        title="Institutions"
        description="Agencies on the platform. The administrator routes complaints here and issues their accounts."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
            Add institution
          </Button>
        }
      />

      {!institutions ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <InstitutionsTable institutions={institutions} totalOpen={totalOpen} onSelect={setSelected} />
      )}

      <InstitutionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(institution: Institution) => setInstitutions((current) => [...(current ?? []), institution])}
      />
      <InstitutionDrawer institution={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
