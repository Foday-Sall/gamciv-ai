import { motion, useReducedMotion } from "motion/react"
import { Building2, ChevronLeft, Home, Lock, RotateCw, Search } from "lucide-react"
import { EASE, SCREEN_VARIANTS, SCREEN_TRANSITION, type PhoneScreenProps } from "./shared"

const WA_PLATFORMS = ["WhatsApp", "SMS", "Telegram", "Web"] as const

/** Screen 4: Web app in the phone browser. */
export default function WebAppScreen({ static: isStatic }: PhoneScreenProps) {
  const reduce = useReducedMotion()
  const skip = isStatic || !!reduce
  return (
    <motion.div
      initial={skip ? false : "enter"}
      animate="center"
      exit="exit"
      variants={SCREEN_VARIANTS}
      transition={SCREEN_TRANSITION}
      className="absolute inset-0 flex flex-col bg-neutral-100"
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 bg-white px-2 py-1.5">
        <ChevronLeft className="h-2.5 w-2.5 text-neutral-400" />
        <Lock className="h-2 w-2 text-neutral-400" />
        <span className="flex-1 truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[7px] text-neutral-500">
          GamFix
        </span>
        <RotateCw className="h-2.5 w-2.5 text-neutral-400" />
      </div>
      {/* Page */}
      <div className="flex-1 overflow-hidden px-2.5 py-2">
        <p className="text-[8.5px] font-bold tracking-tight text-neutral-900">Track your report</p>
        <p className="text-[7px] text-neutral-500">Enter a reference number</p>
        <div className="mt-1.5 flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1">
          <Search className="h-2 w-2 text-neutral-400" />
          <span className="text-[8px] font-medium text-neutral-800">GMC-2026-02418</span>
          {!skip && <span className="ml-auto inline-block h-1.5 w-8 animate-pulse rounded-full bg-neutral-300" />}
        </div>
        <motion.div
          initial={skip ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: skip ? 0 : 0.5, duration: 0.35, ease: EASE }}
          className="mt-1.5 rounded-md bg-white p-2 shadow-sm"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[8px] font-semibold text-neutral-900">Blocked drain, Kairaba Ave</p>
            <span className="shrink-0 rounded-full bg-[#DCFCE7] px-1.5 py-px text-[6px] font-semibold text-[#15803D]">
              Resolved
            </span>
          </div>
          <p className="mt-0.5 text-[7px] text-neutral-500">Routed to KMC · Works department</p>
          <div className="mt-1.5 h-1 w-full rounded-full bg-neutral-100">
            <motion.div
              className="h-full rounded-full bg-[#16A34A]"
              initial={skip ? { width: "100%" } : { width: "8%" }}
              animate={{ width: "100%" }}
              transition={skip ? { duration: 0 } : { duration: 1.4, ease: EASE, delay: 0.7 }}
            />
          </div>
        </motion.div>
        <div className="mt-1.5 flex gap-1">
          {WA_PLATFORMS.map((p, i) => (
            <span
              key={p}
              className={`flex-1 rounded-md border px-1 py-1 text-center text-[6.5px] font-medium ${
                i === 3
                  ? "border-[#9C6A00] bg-[#D99A00] text-[#26180C]"
                  : "border-neutral-200 bg-white text-neutral-500"
              }`}
            >
              {p}
            </span>
          ))}
        </div>
      </div>
      {/* Page bottom bar */}
      <div className="flex items-center justify-between border-t border-neutral-200 bg-white px-4 py-1.5">
        <Home className="h-2.5 w-2.5 text-neutral-400" />
        <Search className="h-2.5 w-2.5 text-[#9C6A00]" />
        <Building2 className="h-2.5 w-2.5 text-neutral-400" />
      </div>
    </motion.div>
  )
}
