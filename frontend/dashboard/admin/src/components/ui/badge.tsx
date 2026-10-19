import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        secondary: "border-transparent bg-muted text-muted-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-[color-mix(in_srgb,var(--ok)_15%,transparent)] text-ok",
        warning: "border-transparent bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] text-warn",
        danger: "border-transparent bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-danger",
        info: "border-transparent bg-[color-mix(in_srgb,var(--info)_15%,transparent)] text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
