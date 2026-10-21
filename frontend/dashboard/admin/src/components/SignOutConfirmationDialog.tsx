import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function SignOutConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  signingOut,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  signingOut: boolean
  error: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !signingOut && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground">
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="font-display text-xl">Sign out of GamFix?</DialogTitle>
          <DialogDescription>
            You will leave your institution workspace and return to the shared sign-in page. Any unsaved work may be lost.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={signingOut}>
            Stay signed in
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Yes, sign out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
