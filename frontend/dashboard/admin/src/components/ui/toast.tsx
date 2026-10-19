import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-3 overflow-hidden rounded-lg border border-border p-4 pr-7 shadow-lg transition-all",
  {
    variants: {
      variant: {
        default: "bg-popover text-popover-foreground",
        success: "border-l-ok bg-popover text-popover-foreground",
        destructive: "border-l-destructive bg-popover text-popover-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const ToastProvider = ToastPrimitive.Provider

const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-4 right-4 z-[100] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = "ToastViewport"

const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = "Toast"

const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-transparent px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = "ToastAction"

const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
      className
    )}
    {...props}
  />
))
ToastClose.displayName = "ToastClose"

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
))
ToastTitle.displayName = "ToastTitle"

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
ToastDescription.displayName = "ToastDescription"

type ToastItem = {
  id: string
  title?: string
  description?: string
  variant?: "default" | "success" | "destructive"
  open: boolean
  onOpenChange: (open: boolean) => void
}

let toastMemory: ToastItem[] = []
const toastListeners = new Set<() => void>()
let toastCounter = 0

function notifyToastListeners() {
  for (const listener of toastListeners) listener()
}

export function toast(item: {
  title?: string
  description?: string
  variant?: "default" | "success" | "destructive"
}) {
  toastCounter += 1
  const id = String(toastCounter)
  toastMemory = [
    ...toastMemory,
    {
      ...item,
      id,
      open: true,
      onOpenChange: (open: boolean) => {
        if (!open) {
          toastMemory = toastMemory.filter((entry) => entry.id !== id)
          notifyToastListeners()
        }
      },
    },
  ]
  notifyToastListeners()
  return {
    id,
    dismiss: () => {
      toastMemory = toastMemory.filter((entry) => entry.id !== id)
      notifyToastListeners()
    },
  }
}

export function useToast() {
  const [items, setItems] = React.useState<ToastItem[]>(toastMemory)
  React.useEffect(() => {
    const sync = () => setItems([...toastMemory])
    toastListeners.add(sync)
    return () => {
      toastListeners.delete(sync)
    }
  }, [])
  return { toasts: items }
}

function Toaster() {
  const { toasts } = useToast()
  return (
    <ToastProvider>
      {toasts.map((item) => (
        <Toast
          key={item.id}
          variant={item.variant}
          open={item.open}
          onOpenChange={item.onOpenChange}
        >
          <div className="flex flex-col gap-0.5">
            {item.title ? <ToastTitle>{item.title}</ToastTitle> : null}
            {item.description ? (
              <ToastDescription>{item.description}</ToastDescription>
            ) : null}
          </div>
          <ToastClose aria-label="Close notification" />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>
type ToastActionElement = React.ReactElement<typeof ToastAction>

export { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastAction, ToastClose, Toaster }
export type { ToastProps, ToastActionElement, ToastItem }
