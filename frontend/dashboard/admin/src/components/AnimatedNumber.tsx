import { useEffect, useState } from "react"
import { useSpring, useReducedMotion } from "framer-motion"

// Animated number counter used by the overview stat cards. Springs up from
// zero on first paint and animates between values. Respects reduced motion.
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  className = "",
}: {
  value: number
  decimals?: number
  suffix?: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(() => (reduce ? value : 0))
  const spring = useSpring(0, { stiffness: 90, damping: 22, mass: 1 })

  useEffect(() => {
    if (reduce) {
      setDisplay(value)
      return
    }
    spring.set(value)
    return spring.on("change", (latest) => setDisplay(latest))
  }, [value, reduce, spring])

  return (
    <span className={`tabular font-display text-3xl font-semibold tracking-tight ${className}`}>
      {`${display.toFixed(decimals)}${suffix}`}
    </span>
  )
}
