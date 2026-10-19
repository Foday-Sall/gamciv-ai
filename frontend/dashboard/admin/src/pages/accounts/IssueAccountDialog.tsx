import { useState } from "react"
import { KeyRound, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createOfficer, type Institution, type Officer, type OfficerRole } from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"
import { ROLE_LABELS, type IssuedAccount } from "./AccountBadges"

/** Issue-account dialog with its two steps: the request form, then the
 *  temporary password handoff screen. */
export default function IssueAccountDialog({
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
  const [issued, setIssued] = useState<IssuedAccount | null>(null)

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
        {issued ? <IssuedStep issued={issued} onDone={() => { reset(); onOpenChange(false) }} /> : (
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

/** Second step of the dialog: the temporary password handoff. */
function IssuedStep({ issued, onDone }: { issued: IssuedAccount; onDone: () => void }) {
  return (
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
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  )
}
