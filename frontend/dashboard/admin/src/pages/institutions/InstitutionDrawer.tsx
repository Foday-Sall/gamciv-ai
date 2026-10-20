import { useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X, Mail, Phone, Hash, Layers, ImagePlus, Building2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { uploadInstitutionLogo, type Institution } from "@/lib/adminApi"
import { AccessBadge, StatusBadge } from "./InstitutionBadges"

/** Slide-in details drawer for the selected institution. */
export default function InstitutionDrawer({
  institution,
  onClose,
}: {
  institution: Institution | null
  onClose: () => void
}) {
  const logoInputRef = useRef<HTMLInputElement>(null)

  const uploadLogo = async (file: File) => {
    if (!institution) return
    try {
      await uploadInstitutionLogo(institution.id, file)
      toast({ title: "Logo uploaded", description: `${institution.name} logo is saved.`, variant: "success" })
    } catch (error) {
      toast({
        title: "Logo upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

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
              <div className="flex items-center gap-3">
                <Building2 className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
                <div>
                  <p className="font-display text-lg font-semibold">{institution.name}</p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <Hash className="h-3.5 w-3.5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                    {institution.shortCode}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => logoInputRef.current?.click()}
                  aria-label="Upload logo"
                  title="Upload logo (PNG/JPEG/WebP, max 2 MB)"
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadLogo(file)
                event.target.value = ""
              }}
            />

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
