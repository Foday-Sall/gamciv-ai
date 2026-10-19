import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createInstitution, ALL_CATEGORIES, type Institution } from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

/** Add-institution dialog: creates an agency and appends it to the page list. */
export default function InstitutionDialog({
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
