import { useEffect, useMemo, useState } from "react"
import { Plus, UserCog, ShieldAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import {
  getInstitutions,
  getOfficers,
  toggleOfficerActive,
  type Institution,
  type Officer,
} from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"
import AccountsTable from "@/pages/accounts/AccountsTable"
import IssueAccountDialog from "@/pages/accounts/IssueAccountDialog"

/** Accounts admin: list of issued logins plus the issue-account dialog. */
export default function AccountsPage() {
  const [officers, setOfficers] = useState<Officer[] | null>(null)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getOfficers(), getInstitutions()]).then(([officerData, institutionData]) => {
      if (cancelled) return
      setOfficers(officerData)
      setInstitutions(institutionData)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const activeCount = useMemo(() => (officers ?? []).filter((entry) => entry.active).length, [officers])

  const toggleActive = async (officer: Officer, next: boolean) => {
    setBusyId(officer.id)
    try {
      const updated = await toggleOfficerActive(officer.id, next)
      setOfficers((current) =>
        (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry))
      )
      toast({
        title: next ? "Account activated" : "Account suspended",
        description: `${updated.name} at ${updated.institutionName}.`,
        variant: next ? "success" : "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Logins the administrator issued to institutions. No self-registration exists anywhere in the system."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
            Issue account
          </Button>
        }
      />

      {!officers ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <AccountsTable
          officers={officers}
          busyId={busyId}
          onToggleActive={toggleActive}
          header={
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserCog className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                {officers.length} accounts issued, {activeCount} active
              </p>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                Roles and access levels are granted only here
              </p>
            </div>
          }
        />
      )}

      <IssueAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        institutions={institutions}
        onCreated={(officer: Officer) => setOfficers((current) => [...(current ?? []), officer])}
      />
    </div>
  )
}
