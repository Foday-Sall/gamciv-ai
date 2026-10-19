/**
 * PageTransition — fluid fade/slide between routes (boss design update #2).
 * Wrap the routed page content; AnimatePresence keyed by pathname.
 * 150–220ms ease-out; motion is disabled entirely under prefers-reduced-motion
 * via MotionConfig reducedMotion="user" in AppShell.
 */
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

export default function PageTransition({
  routeKey,
  children,
}: {
  routeKey: string
  children: ReactNode
}) {
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

export { EASE_OUT }
