import { motion, useReducedMotion, type Transition, type Variants } from "motion/react"
import type { ReactNode } from "react"

/* ---------------------------------- motion ---------------------------------- */

export const EASE: Transition["ease"] = [0.16, 1, 0.3, 1]
export const VIEWPORT = { once: true, margin: "-100px" } as const

export function fadeUp(y = 24): Variants {
  return {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
  }
}

export function Stagger({
  children,
  className,
  delayChildren = 0,
  stagger = 0.1,
}: {
  children: ReactNode
  className?: string
  delayChildren?: number
  stagger?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView={reduce ? undefined : "show"}
      viewport={VIEWPORT}
      variants={{
        hidden: {},
        show: { transition: { delayChildren, staggerChildren: stagger } },
      }}
    >
      {children}
    </motion.div>
  )
}

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

export function Lift({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

export function FlagRule({ className = "" }: { className?: string }) {
  return (
    <div className={"flex h-1 w-16 " + className} aria-hidden="true">
      <span className="flex-1 bg-[#CE1126]" />
      <span className="flex-1 bg-[#0F47AF]" />
      <span className="flex-1 bg-[#3A7728]" />
    </div>
  )
}
