import { useEffect, useMemo, useState } from "react"
import { motion, type Variants } from "framer-motion"
import { Plus, KeyRound, Copy, UserCog, ShieldAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/PageHeader"
import {
  createOfficer,
  getInstitutions,
  getOfficers,
  toggleOfficerActive,
  type Institution,
  type Officer,
  type OfficerRole,
} from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"

const containerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05 } },
}

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
}

const ROLE_LABELS: Record<OfficerRole, string> = {
  "institution-admin": "Institution admin",
  officer: "Officer",
  "view-only": "View only",
}

function RoleBadge({ role }: { role: OfficerRole }) {
  const variant = role === "institution-admin" ? "success" : role === "officer" ? "default" : "info"
  return <Badge variant={variant}>{ROLE_LABELS[role]}</Badge>
}

function IssueAccountDialog({
  open,
  onOpenChange,
  institutions,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  institutions: Institution[]
  onCreated: (officer: Officer) => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [institutionId, setInstitutionId] = useState("")
  const [role, setRole] = useState<OfficerRole | "">("")
  const [department, setDepartment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [issued, setIssued] = useState<{ officer: Officer; temporaryPassword: string } | null>(null)

  const reset = () => {
    setName("")
    setEmail("")
    setInstitutionId("")
    setRole("")
    setDepartment("")
    setIssued(null)
  }

  const submit = async () => {
    if (!name.trim() || !email.trim() || !institutionId || !role) return
    setSubmitting(true)
    try {
      const result = await createOfficer({
        name: name.trim(),
        username: email.trim().split("@")[0] ?? email.trim(),
        email: email.trim(),
        institutionId,
        role,
        department: department.trim(),
      })
      setIssued(result)
      onCreated(result.officer)
      toast({
        title: "Account issued",
        description: `Login created for ${result.officer.name} at ${result.officer.institutionName}.`,
        variant: "success",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = Boolean(name.trim() && email.trim() && institutionId && role)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                Account issued
              </DialogTitle>
              <DialogDescription>
                Hand these login details to {issued.officer.institutionName}. They sign in and change the
                password on first use.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="rounded-lg border border-border bg-input/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Temporary password
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="rounded bg-background px-2 py-1 font-mono text-sm tracking-wide">
                    {issued.temporaryPassword}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(issued.temporaryPassword).then(() =>
                        toast({ title: "Copied", description: "Temporary password copied to clipboard." })
                      )
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                    Copy
                  </Button>
                </div>
              </div>
              <Separator />
              <div className="grid gap-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Account:</span> {issued.officer.name} (
                  {issued.officer.username})
                </p>
                <p>
                  <span className="text-muted-foreground">Institution:</span> {issued.officer.institutionName}
                </p>
                <p>
                  <span className="text-muted-foreground">Role granted:</span> {ROLE_LABELS[issued.officer.role]}
                </p>
                {issued.officer.department ? (
                  <p>
                    <span className="text-muted-foreground">Department:</span> {issued.officer.department}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Issue account</DialogTitle>
              <DialogDescription>
                Create a login for an institution. There is no self-registration: only this administrator
                console issues accounts.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="acct-name">Account name</Label>
                  <Input
                    id="acct-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Lamin Sanneh"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="acct-email">Work email</Label>
                  <Input
                    id="acct-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@agency.gm"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="acct-institution">Institution</Label>
                  <Select value={institutionId} onValueChange={setInstitutionId}>
                    <SelectTrigger id="acct-institution">
                      <SelectValue placeholder="Select institution" />
                    </SelectTrigger>
                    <SelectContent>
                      {institutions.map((institution) => (
                        <SelectItem key={institution.id} value={institution.id}>
                          {institution.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="acct-role">Role granted</Label>
                  <Select value={role} onValueChange={(value) => setRole(value as OfficerRole)}>
                    <SelectTrigger id="acct-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="institution-admin">Institution admin</SelectItem>
                      <SelectItem value="officer">Officer</SelectItem>
                      <SelectItem value="view-only">View only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="acct-department">Department (optional)</Label>
                <Input
                  id="acct-department"
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  placeholder="Customer Care"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || !canSubmit}>
                {submitting ? "Issuing..." : "Issue account"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

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
        <Card>
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
          <motion.div variants={containerVariants} initial="hidden" animate="shown">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Role granted</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {officers.map((officer) => (
                  <motion.tr
                    key={officer.id}
                    variants={rowVariants}
                    whileHover={{ y: -2 }}
                    className="border-b border-border transition-colors hover:bg-muted/40"
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{officer.name}</p>
                        <p className="text-xs text-muted-foreground">{officer.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{officer.institutionName}</TableCell>
                    <TableCell>
                      <RoleBadge role={officer.role} />
                    </TableCell>
                    <TableCell>{officer.department || "Unassigned"}</TableCell>
                    <TableCell>
                      <Switch
                        checked={officer.active}
                        disabled={busyId === officer.id}
                        onCheckedChange={(next) => toggleActive(officer, next)}
                        aria-label={`Toggle account for ${officer.name}`}
                      />
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </motion.div>
        </Card>
      )}

      <IssueAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        institutions={institutions}
        onCreated={(officer) => setOfficers((current) => [...(current ?? []), officer])}
      />
    </div>
  )
}
