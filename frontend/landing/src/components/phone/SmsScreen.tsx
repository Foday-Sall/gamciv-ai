import { motion, useReducedMotion } from "motion/react"
import { ChevronLeft, MessageSquare } from "lucide-react"
import { EASE, SCREEN_VARIANTS, SCREEN_TRANSITION, type PhoneScreenProps } from "./shared"

const SMS_SCRIPT = [
  {
    out: false,
    text: "GAMCIV: Report GMC-2026-02418 received. Routed to KMC Works. Reply STATUS for updates.",
    time: "09:41",
  },
  { out: true, text: "STATUS GMC-2026-02418", time: "10:03" },
  {
    out: false,
    text: "GMC-2026-02418: Crew scheduled this week. We will text you when the drain is cleared.",
    time: "10:15",
  },
  {
    out: false,
    text: "GMC-2026-02418 CLOSED: Drain cleared today. Reply any time to report a new issue.",
    time: "16:40",
  },
]

/** Screen 2: SMS thread. */
export default function SmsScreen({ static: isStatic }: PhoneScreenProps) {
  const reduce = useReducedMotion()
  const skip = isStatic || !!reduce
  return (
    <motion.div
      initial={skip ? false : "enter"}
      animate="center"
      exit="exit"
      variants={SCREEN_VARIANTS}
      transition={SCREEN_TRANSITION}
      className="absolute inset-0 flex flex-col bg-[#F5F6FA]"
    >
      {/* SMS header */}
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-2.5 py-2">
        <ChevronLeft className="h-3 w-3 text-[#2A1B10]" />
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2A1B10]">
          <MessageSquare className="h-3 w-3 text-white" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold leading-none text-neutral-900">GamCiv</p>
          <p className="mt-0.5 text-[7px] leading-none text-neutral-500">+220 241 1818</p>
        </div>
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-hidden px-2.5 py-2">
        <div className="flex flex-col gap-1.5">
          {SMS_SCRIPT.map((m, i) => (
            <motion.div
              key={m.text.slice(0, 14)}
              initial={skip ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: skip ? 0 : 0.35 + i * 0.45, duration: 0.3, ease: EASE }}
              className={m.out ? "max-w-[86%] self-end" : "max-w-[86%] self-start"}
            >
              <div
                className={
                  m.out
                    ? "rounded-2xl rounded-br-sm bg-[#2A1B10] px-2 py-1.5"
                    : "rounded-2xl rounded-bl-sm bg-white px-2 py-1.5 shadow-sm"
                }
              >
                <p className={`text-[8.5px] leading-snug ${m.out ? "text-white" : "text-neutral-800"}`}>{m.text}</p>
                <div
                  className={`mt-0.5 text-right text-[6px] ${m.out ? "text-white/60" : "text-neutral-400"}`}
                >
                  {m.time}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      {/* Compose bar */}
      <div className="border-t border-neutral-200 bg-white px-2.5 py-1.5">
        <div className="rounded-full bg-neutral-100 px-2.5 py-1 text-[7.5px] text-neutral-400">Text message</div>
      </div>
    </motion.div>
  )
}
