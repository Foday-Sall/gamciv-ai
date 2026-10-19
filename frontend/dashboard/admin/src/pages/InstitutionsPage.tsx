import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Plus, X, Mail, Phone, Hash, Building2, Layers } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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
import { PageHeader } from "@/components/PageHeader"
import { createInstitution, getInstitutions, ALL_CATEGORIES, type Institution } from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

const containerVariants: { hidden: {}; shown: { transition: { staggerChildren: number } } } = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05 } },
}

const rowVariants: { hidden: { opacity: number; y: number }; shown: { opacity: number; y: number } } = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
}

function AccessBadge({ level }: { level: Institution["accessLevel"] }) {
  const variant = level === "full" ? "success" : level === "restricted" ? "warning" : "info"
  return <Badge variant={variant}>{level}</Badge>
}

function StatusBadge({ status }: { status: Institution["status"] }) {
  return (
    <Badge variant={status === "active" ? "success" : "danger"}>
      {status === "active" ? "Active" : "Suspended"}
    </Badge>
  )
}

function InstitutionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (institution: Institution) => void
}) {
  const [name, setName] = useState("")
  const [shortCode, setShortCode] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [scope, setScope] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const toggleScope = (category: string) => {
    setScope((current) =>
      current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category]
    )
  }

  const reset = () => {
    setName("")
    setShortCode("")
    setEmail("")
    setPhone("")
    setScope([])
  }

  const submit = async () => {
    if (!name.trim() || !shortCode.trim() || !email.trim()) return
    setSubmitting(true)
    try {
      const created = await createInstitution({
        name: name.trim(),
        shortCode: shortCode.trim(),
        contactEmail: email.trim(),
        contactPhone: phone.trim(),
        categoryScope: scope,
      })
      onCreated(created)
      toast({
        title: "Institution created",
        description: `${created.name} can now receive routed complaints.`,
        variant: "success",
      })
      reset()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add institution</DialogTitle>
          <DialogDescription>
            Register an agency so complaints can be routed to it and accounts can be issued for it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="inst-name">Institution name</Label>
            <Input
              id="inst-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="National Water and Electricity Company"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inst-code">Short code</Label>
              <Input
                id="inst-code"
                value={shortCode}
                onChange={(event) => setShortCode(event.target.value)}
                placeholder="NAWEC"
                maxLength={10}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inst-email">Contact email</Label>
              <Input
                id="inst-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="support@example.gm"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inst-phone">Contact phone</Label>
            <Input
              id="inst-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+220 000 0000"
            />
          </div>
          <div className="grid gap-2">
            <Label>Category scope</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((category) => {
                const selected = scope.includes(category)
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleScope(category)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {category}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim() || !shortCode.trim() || !email.trim()}>
            {submitting ? "Creating..." : "Create institution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InstitutionDrawer({
  institution,
  onClose,
}: {
  institution: Institution | null
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {institution ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
            aria-label={`${institution.name} details`}
          >
            <div className="flex items-start justify-between border-b border-border p-6">
              <div>
                <p className="font-display text-lg font-semibold">{institution.name}</p>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  {institution.shortCode}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6 slim-scroll">
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Open complaints</p>
                    <p className="mt-1 font-display text-2xl font-semibold tabular">{institution.openComplaints}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Accounts</p>
                    <p className="mt-1 font-display text-2xl font-semibold tabular">{institution.officers}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</p>
                <p className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  {institution.contactEmail}
                </p>
                <p className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  {institution.contactPhone}
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
                <div className="flex gap-2">
                  <AccessBadge level={institution.accessLevel} />
                  <StatusBadge status={institution.status} />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  Category scope
                </p>
                <div className="flex flex-wrap gap-2">
                  {institution.categoryScope.length > 0 ? (
                    institution.categoryScope.map((category) => (
                      <Badge key={category} variant="secondary">
                        {category}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No categories assigned.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-border p-4">
              <Button variant="outline" className="w-full" onClick={onClose}>
                Close
              </Button>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}

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
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
              {institutions.length} institutions, {totalOpen} open complaints in total
            </p>
          </div>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="shown"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Institution</TableHead>
                  <TableHead>Open complaints</TableHead>
                  <TableHead>Accounts</TableHead>
                  <TableHead>Access level</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {institutions.map((institution) => (
                  <motion.tr
                    key={institution.id}
                    variants={rowVariants}
                    className="cursor-pointer border-b border-border transition-colors hover:bg-muted/40"
                    whileHover={{ y: -2 }}
                    onClick={() => setSelected(institution)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{institution.name}</p>
                        <p className="text-xs text-muted-foreground">{institution.shortCode}</p>
                      </div>
                    </TableCell>
                    <TableCell className="tabular">{institution.openComplaints}</TableCell>
                    <TableCell className="tabular">{institution.officers}</TableCell>
                    <TableCell>
                      <AccessBadge level={institution.accessLevel} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={institution.status} />
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          </motion.div>
        </Card>
      )}

      <InstitutionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(institution) => setInstitutions((current) => [...(current ?? []), institution])}
      />
      <InstitutionDrawer institution={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
