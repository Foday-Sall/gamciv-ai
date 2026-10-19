import { motion } from "motion/react"
import { EASE } from "./shared"
import type { PhoneScreen } from "./shared"

/** Channel badge below the notch, animating in on every screen change. */
export default function PhoneCaseBadge({ screen }: { screen: PhoneScreen }) {
  return (
    <div className="flex items-center gap-1.5 border-y border-white/5 bg-white/5 px-3 py-1.5">
      <motion.div
        key={screen.id}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="flex min-w-0 items-center gap-1.5"
      >
        <screen.icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2.2} style={{ color: screen.accent }} />
        <span className="text-[8px] font-semibold tracking-tight text-zinc-100">{screen.label}</span>
        <span className="ml-auto shrink-0 rounded-full bg-white/10 px-1.5 py-px text-[6.5px] font-medium text-zinc-300">
          {screen.badge}
        </span>
      </motion.div>
    </div>
  )
}
