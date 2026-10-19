import { motion } from "framer-motion"
import type { ReactNode } from "react"

// Page header with title, description, and an optional action area.
// Every page fades and slides in on mount (reduced motion aware).
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        shown: { opacity: 1, y: 0 },
      }}
      initial="hidden"
      animate="shown"
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mb-6 flex flex-wrap items-end justify-between gap-4"
    >
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </motion.div>
  )
}

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}
