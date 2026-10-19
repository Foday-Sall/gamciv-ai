import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react"
import {
  MessageCircle,
  MessageSquare,
  Send,
  Globe,
  CheckCheck,
  Bell,
  CheckCircle2,
  Search,
  Signal,
  Wifi,
  BatteryMedium,
  ChevronLeft,
  Lock,
  RotateCw,
  Home,
  Building2,
} from "lucide-react"
import { EASE } from "@/components/sections/shared"

/* ---------------------------------- Gambia ---------------------------------- */

/** Flag of The Gambia, reduced to clean bands: red / blue / green with white
 *  fimbriations. Official 2:3 ratio, drawn on a 27x18 grid. */
function GambiaFlag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 27 18" role="img" aria-label="Flag of The Gambia" focusable="false">
      <title>Flag of The Gambia</title>
      <rect width="27" height="18" fill="#0F47AF" />
      <rect width="27" height="6.6" fill="#CE1126" />
      <rect y="11.4" width="27" height="6.6" fill="#3A7728" />
      <rect y="6" width="27" height="0.6" fill="#ffffff" />
      <rect y="11.4" width="27" height="0.6" fill="#ffffff" />
    </svg>
  )
}

/* --------------------------- screen transition core -------------------------- */

/** How long each channel screen stays before auto-advancing (ms). Must match
 *  the .phone-story-bar animation duration in index.css. */
const SCREEN_DURATION = 2800

const SCREEN_VARIANTS = {
  enter: { x: "100%" },
  center: { x: "0%" },
  exit: { x: "-32%", opacity: 0 },
}
const SCREEN_TRANSITION = { duration: 0.45, ease: EASE }

/* -------------------------------- screen 1: WhatsApp -------------------------------- */

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

function WhatsAppScreen({ static: isStatic }: { static?: boolean }) {
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

/* -------------------------------- screen 2: SMS -------------------------------- */

const SMS_SCRIPT = [
  {
    out: false,
    text: "GAMCIV: Report GC-2418 received. Routed to KMC Works. Reply STATUS for updates.",
    time: "09:41",
  },
  { out: true, text: "STATUS GC-2418", time: "10:03" },
  {
    out: false,
    text: "GC-2418: Crew scheduled this week. We will text you when the drain is cleared.",
    time: "10:15",
  },
  {
    out: false,
    text: "GC-2418 CLOSED: Drain cleared today. Reply any time to report a new issue.",
    time: "16:40",
  },
]

function SmsScreen({ static: isStatic }: { static?: boolean }) {
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

/* ------------------------------ screen 3: Telegram ------------------------------ */

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

function TelegramScreen({ static: isStatic }: { static?: boolean }) {
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

/* ------------------------------- screen 4: Web app ------------------------------- */

const WA_PLATFORMS = ["WhatsApp", "SMS", "Telegram", "Web"] as const

function WebAppScreen({ static: isStatic }: { static?: boolean }) {
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
          gamciv.pocketsoftware.dev
        </span>
        <RotateCw className="h-2.5 w-2.5 text-neutral-400" />
      </div>
      {/* Page */}
      <div className="flex-1 overflow-hidden px-2.5 py-2">
        <p className="text-[8.5px] font-bold tracking-tight text-neutral-900">Track your report</p>
        <p className="text-[7px] text-neutral-500">Enter a reference number</p>
        <div className="mt-1.5 flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1">
          <Search className="h-2 w-2 text-neutral-400" />
          <span className="text-[8px] font-medium text-neutral-800">GC-2418</span>
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

/* ---------------------------------- registry ---------------------------------- */

const SCREENS = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    accent: "#25D366",
    badge: "live chat",
    Component: WhatsAppScreen,
  },
  {
    id: "sms",
    label: "SMS",
    icon: MessageSquare,
    accent: "#9C6A00",
    badge: "any phone",
    Component: SmsScreen,
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: Send,
    accent: "#229ED9",
    badge: "instant alerts",
    Component: TelegramScreen,
  },
  {
    id: "web",
    label: "Web",
    icon: Globe,
    accent: "#9C6A00",
    badge: "in browser",
    Component: WebAppScreen,
  },
] as const

/* --------------------------------- component --------------------------------- */

/**
 * PhoneCase, a device mockup that behaves like a real phone: one full-width
 * channel screen at a time (WhatsApp chat → SMS → Telegram notifications →
 * web app), auto-advancing every ~3s with story-style progress segments.
 * With reduced motion: a single static screen, no transitions. Decorative;
 * rendered with aria-hidden.
 */
export default function PhoneCase() {
  const reduce = useReducedMotion()
  const shellRef = useRef<HTMLDivElement>(null)
  const inView = useInView(shellRef, { amount: 0.25 })
  const [screen, setScreen] = useState(0)
  const progress = useRef(0)

  // Restart the story from the first channel whenever the phone re-enters view.
  useEffect(() => {
    if (inView) {
      progress.current = 0
      setScreen(0)
    }
  }, [inView])

  // Auto-advance through the channels; paused for reduced motion and while the
  // phone is scrolled out of view (rAF stops firing, so no drift).
  useEffect(() => {
    if (reduce || !inView) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      progress.current += now - last
      last = now
      if (progress.current >= SCREEN_DURATION) {
        progress.current = 0
        setScreen((s) => (s + 1) % SCREENS.length)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduce, inView])

  const Current = SCREENS[screen]

  return (
    <div ref={shellRef} className={`relative ${reduce ? "" : "phone-shell"}`} aria-hidden="true">
      {/* Frame */}
      <div className="w-52 rounded-[24px] border border-white/15 bg-zinc-950 p-2 shadow-[0_20px_50px_-18px_rgba(42,27,16,0.45)]">
        <div className="overflow-hidden rounded-[16px] bg-[#1C130B]">
          {/* Screen top: camera pill + Gambia flag */}
          <div className="px-3 pt-2.5 pb-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-1 rounded-full bg-zinc-600" />
                <span className="inline-block h-1 w-1 rounded-full bg-zinc-600" />
              </div>
              {reduce ? (
                <div className="h-4 w-20 rounded-full bg-zinc-800" />
              ) : (
                <div className="phone-pill h-4 rounded-full bg-zinc-800" />
              )}
              <GambiaFlag className="h-2.5 w-auto rounded-[1px]" />
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-[7px] font-semibold text-zinc-400">09:41</span>
            <div className="flex items-center gap-1 text-zinc-500">
              <Signal className="h-1.5 w-1.5" />
              <Wifi className="h-1.5 w-1.5" />
              <BatteryMedium className="h-1.5 w-1.5" />
            </div>
          </div>

          {/* Channel badge (below the notch) */}
          <div className="flex items-center gap-1.5 border-y border-white/5 bg-white/5 px-3 py-1.5">
            <motion.div
              key={Current.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <Current.icon className="h-2.5 w-2.5 shrink-0" strokeWidth={2.2} style={{ color: Current.accent }} />
              <span className="text-[8px] font-semibold tracking-tight text-zinc-100">{Current.label}</span>
              <span className="ml-auto shrink-0 rounded-full bg-white/10 px-1.5 py-px text-[6.5px] font-medium text-zinc-300">
                {Current.badge}
              </span>
            </motion.div>
          </div>

          {/* Rotating channel screens, one full-width app at a time */}
          <div className="relative h-[336px]">
            {reduce ? (
              <Current.Component static />
            ) : (
              <AnimatePresence initial={false}>
                <Current.Component key={Current.id} />
              </AnimatePresence>
            )}
          </div>

          {/* Story-style progress segments */}
          <div className="flex items-center gap-1 px-3 pt-2 pb-2.5">
            {SCREENS.map((s, i) => (
              <div key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={
                    i < screen
                      ? "h-full w-full bg-white/40"
                      : i === screen
                        ? "phone-story-bar h-full bg-white"
                        : "h-full w-0 bg-white"
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
