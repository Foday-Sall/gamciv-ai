import { motion, useReducedMotion } from "motion/react"
import { CheckCircle2, Bell, Send } from "lucide-react"
import { EASE, SCREEN_VARIANTS, SCREEN_TRANSITION, type PhoneScreenProps } from "./shared"

const TG_NOTIFS = [
  {
    icon: Send,
    color: "#229ED9",
    bg: "rgba(34,158,217,0.14)",
    title: "GamCiv Bot",
    time: "09:41",
    body: "Report GC-2418 received: routed to KMC. Send the reference any time to track it.",
  },
  {
    icon: Bell,
    color: "#B45309",
    bg: "rgba(180,83,9,0.12)",
    title: "Status update",
    time: "10:15",
    body: "Crew assigned to Kairaba Avenue. Estimated fix: Friday.",
  },
  {
    icon: CheckCircle2,
    color: "#16A34A",
    bg: "rgba(22,163,74,0.12)",
    title: "Case resolved",
    time: "16:40",
    body: "Drain cleared and confirmed. Thanks for reporting.",
  },
]

/** Screen 3: Telegram notifications. */
export default function TelegramScreen({ static: isStatic }: PhoneScreenProps) {
  const reduce = useReducedMotion()
  const skip = isStatic || !!reduce
  return (
    <motion.div
      initial={skip ? false : "enter"}
      animate="center"
      exit="exit"
      variants={SCREEN_VARIANTS}
      transition={SCREEN_TRANSITION}
      className="absolute inset-0 flex flex-col bg-white"
    >
      {/* Telegram header */}
      <div className="flex items-center gap-2 border-b border-neutral-100 px-2.5 py-2">
        <Send className="h-3.5 w-3.5 text-[#229ED9]" strokeWidth={2.2} />
        <p className="text-[9px] font-semibold text-neutral-900">Telegram</p>
        <span className="ml-auto rounded-full bg-[#229ED9]/10 px-1.5 py-0.5 text-[6.5px] font-medium text-[#229ED9]">
          Notifications
        </span>
      </div>
      {/* Notification feed */}
      <div className="flex-1 overflow-hidden bg-[#F1F3F6] px-2.5 py-2">
        <div className="flex flex-col gap-1.5">
          {TG_NOTIFS.map((n, i) => (
            <motion.div
              key={n.title}
              initial={skip ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: skip ? 0 : 0.35 + i * 0.45, duration: 0.3, ease: EASE }}
              className="rounded-lg bg-white p-2 shadow-sm"
            >
              <div className="flex items-start gap-1.5">
                <span
                  className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: n.bg }}
                >
                  <n.icon className="h-2.5 w-2.5" strokeWidth={2.2} style={{ color: n.color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <p className="truncate text-[8px] font-semibold text-neutral-900">{n.title}</p>
                    <span className="text-[6px] text-neutral-400">{n.time}</span>
                  </div>
                  <p className="mt-0.5 text-[8px] leading-snug text-neutral-600">{n.body}</p>
                </div>
              </div>
            </motion.div>
          ))}
          <motion.div
            initial={skip ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: skip ? 0 : 0.35 + TG_NOTIFS.length * 0.45, duration: 0.3, ease: EASE }}
            className="mx-auto mt-0.5 rounded-full bg-[#229ED9] px-2 py-0.5 text-[6.5px] font-medium text-white"
          >
            From @GamCivBot
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
