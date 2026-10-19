import { motion, useReducedMotion } from "motion/react"
import { CheckCheck, ChevronLeft, MessageCircle } from "lucide-react"
import { EASE, SCREEN_VARIANTS, SCREEN_TRANSITION, type PhoneScreenProps } from "./shared"

const WA_SCRIPT = [
  { from: "user" as const, text: "The drain on Kairaba Avenue is blocked. It floods every rain.", time: "09:41" },
  {
    from: "agent" as const,
    text: "Noted: KMC drainage issue. Reference GC-2418. Forwarded to their works department.",
    time: "09:41",
  },
  {
    from: "agent" as const,
    text: "A crew is scheduled this week. I will message you when it is done.",
    time: "09:42",
  },
  { from: "user" as const, text: "Any update on GC-2418?", time: "10:03" },
]

/** Screen 1: WhatsApp chat. */
export default function WhatsAppScreen({ static: isStatic }: PhoneScreenProps) {
  const reduce = useReducedMotion()
  const skip = isStatic || !!reduce
  return (
    <motion.div
      initial={skip ? false : "enter"}
      animate="center"
      exit="exit"
      variants={SCREEN_VARIANTS}
      transition={SCREEN_TRANSITION}
      className="absolute inset-0 flex flex-col bg-[#075E54]"
    >
      {/* WhatsApp header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <ChevronLeft className="h-3 w-3 text-white/80" />
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#25D366]">
          <MessageCircle className="h-3.5 w-3.5 text-white" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold leading-none text-white">GamCiv Reports</p>
          <p className="mt-0.5 text-[7px] leading-none text-white/60">online</p>
        </div>
        <span className="ml-auto rounded-full bg-white/15 px-1.5 py-0.5 text-[6.5px] font-medium text-white/80">
          Business
        </span>
      </div>
      {/* Chat body */}
      <div className="flex-1 overflow-hidden bg-[#ECE5DD] px-2.5 py-2">
        <div className="mx-auto mb-1.5 w-fit rounded-md bg-[#FFEFC2]/80 px-2 py-0.5 text-[6.5px] font-medium text-[#54656F]">
          Today
        </div>
        <div className="flex flex-col gap-1.5">
          {WA_SCRIPT.map((m, i) => (
            <motion.div
              key={m.text.slice(0, 14)}
              initial={skip ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: skip ? 0 : 0.35 + i * 0.45, duration: 0.3, ease: EASE }}
              className={m.from === "user" ? "max-w-[86%] self-end" : "max-w-[86%] self-start"}
            >
              <div
                className={
                  m.from === "user"
                    ? "rounded-lg rounded-br-sm bg-[#DCF8C6] px-2 py-1.5 shadow-sm"
                    : "rounded-lg rounded-bl-sm bg-white px-2 py-1.5 shadow-sm"
                }
              >
                <p className="text-[8.5px] leading-snug text-neutral-800">{m.text}</p>
                <div className="mt-0.5 flex items-center justify-end gap-0.5">
                  <span className="text-[6px] text-neutral-500">{m.time}</span>
                  {m.from === "user" && <CheckCheck className="h-2 w-2 text-[#53BDEB]" strokeWidth={2.5} />}
                </div>
              </div>
            </motion.div>
          ))}
          <motion.div
            initial={skip ? false : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: skip ? 0 : 0.35 + WA_SCRIPT.length * 0.45, duration: 0.3, ease: EASE }}
            className="max-w-[86%] self-start"
          >
            <div className="rounded-lg rounded-bl-sm bg-white px-2 py-1.5 shadow-sm">
              <p className="text-[8.5px] leading-snug text-neutral-800">
                Cleared today. GC-2418 is closed.
              </p>
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="rounded-full bg-[#DCFCE7] px-1.5 py-px text-[6.5px] font-semibold text-[#15803D]">
                  Resolved
                </span>
                <div className="flex items-center gap-0.5">
                  <span className="text-[6px] text-neutral-500">10:15</span>
                  <CheckCheck className="h-2 w-2 text-[#53BDEB]" strokeWidth={2.5} />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
