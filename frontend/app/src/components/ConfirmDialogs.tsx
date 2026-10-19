/**
 * Confirmation dialogs used across the app, styled to the warm palette:
 * sand background, hairline border, destructive terracotta for the risky
 * action, primary green for the safe one.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** Sign-out: "Are you sure you want to sign out?" with cancel/confirm. */
export function SignOutDialog({
  open,
  onOpenChange,
  onConfirm,
  busy = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to sign out?</AlertDialogTitle>
          <AlertDialogDescription>
            You can sign back in any time. Your reports keep their progress.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-11">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy ? 'Signing out…' : 'Yes, sign out'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Final submit step: "Submit this report?" with cancel/confirm. */
export function SubmitReportDialog({
  open,
  onOpenChange,
  onConfirm,
  busy = false,
  summary,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  busy?: boolean
  summary?: string | null
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Submit this report?</AlertDialogTitle>
          <AlertDialogDescription>
            {summary
              ? summary
              : 'Once submitted it is sent to the responsible service. You will get a tracking number to follow it.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-11">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="min-h-11 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy ? 'Submitting…' : 'Yes, submit report'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Leaving a half-filled wizard: "Discard this report?" (spec §7b). */
export function DiscardReportDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this report?</AlertDialogTitle>
          <AlertDialogDescription>
            Everything you've filled in so far will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">Keep editing</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
