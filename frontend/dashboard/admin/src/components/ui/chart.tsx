import * as React from "react"
import { cn } from "@/lib/utils"

export type ChartConfig = Record<string, { label: string; color: string }>

export function ChartContainer({
  config,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  config: ChartConfig
  children: React.ReactNode
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]),
  ) as React.CSSProperties

  return (
    <div
      data-chart="dashboard"
      className={cn("w-full", className)}
      style={{ ...style, ...props.style }}
      {...props}
    >
      {children}
    </div>
  )
}

type ChartTooltipEntry = {
  name?: string
  value?: string | number
  color?: string
  dataKey?: string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: ChartTooltipEntry[]
  label?: React.ReactNode
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="min-w-36 rounded-md border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
      <p className="mb-1.5 font-medium">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey ?? entry.name} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: entry.color }} aria-hidden="true" />
              {entry.name}
            </span>
            <span className="font-semibold tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
