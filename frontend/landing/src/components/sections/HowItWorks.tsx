import { motion } from "motion/react"
import {
  Check,
  Clock,
  Search,
  MessageCircle,
  MessageSquare,
  Send,
  Globe,
} from "lucide-react"
import PhoneCase from "@/components/PhoneCase"
import ChatFlow, { type ChatMessage } from "@/components/ChatFlow"
import { Stagger, Reveal, fadeUp } from "@/components/sections/shared"

const trackerSteps = [
  {
    icon: "check" as const,
    title: "Report received",
    time: "08:14",
    detail: "Drainage issue logged from WhatsApp",
  },
  {
    icon: "check" as const,
    title: "Routed to NAWEC",
    time: "08:15",
    detail: "Matched to the electricity desk",
  },
  {
    icon: "check" as const,
    title: "Crew assigned",
    time: "Mon",
    detail: "Team 3 scheduled for Bakoteh",
  },
  {
    icon: "current" as const,
    title: "Work in progress",
    time: "Today",
    detail: "Crew on site, line section isolated",
  },
  {
    icon: "pending" as const,
    title: "Resolved",
    time: "",
    detail: "You get a message when it is done",
  },
]

const chatScript: ChatMessage[] = [
  { from: "user", text: "The drain on Kairaba Avenue is blocked. It floods whenever it rains." },
  {
    from: "agent",
    text: "Noted. This is a KMC drainage issue. Reference #GC-2418. We have forwarded it to their works department.",
    meta: "Routed just now",
  },
  { from: "user", text: "Any update on #GC-2418?" },
  {
    from: "agent",
    text: "KMC says a crew is scheduled this week. I will message you when it is done.",
    meta: "Status: in progress",
  },
  { from: "agent", text: "Cleared today. #GC-2418 is closed.", meta: "Resolved" },
]

const steps = [
  {
    n: "01",
    t: "Send what you see",
    d: "A blocked drain in Bundung. A street light dark in Bakoteh for three weeks. Take a photo, say where you are, press send. That is the whole job.",
  },
  {
    n: "02",
    t: "GamCiv routes it",
    d: "The system reads your report, understands what it is, and routes it straight to the office that owns the problem — KMC, NAWEC, NRA, NEA or the police desk. No wrong door, no runaround.",
  },
  {
    n: "03",
    t: "You get a reference",
    d: "Your case gets a number the moment it is filed. Quote it any time and the system tells you exactly where things stand — no calling, no visiting, no guessing.",
  },
  {
    n: "04",
    t: "It is followed to a fix",
    d: "Deadlines are set. If the office misses one, the case escalates on its own. You hear every step in the same chat until the day it is fixed — and you confirm it.",
  },
]

/* How it works + tracker case card. Steps are numbered entries on hairline
   rules; the four channels sit as a single strip above them. */
export default function HowItWorks() {
  return (
    <section id="how" className="hairline-b" aria-labelledby="how-heading">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 md:px-8 lg:grid-cols-[1fr_auto] lg:gap-16">
        <div>
          <h2 id="how-heading" className="max-w-xl text-balance text-3xl font-semibold tracking-tight font-display md:text-4xl">
            One message starts the case
          </h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            No portal to learn, no form to decode. If you can send a WhatsApp message, you can hold an institution
            to its job.
          </p>
          <Stagger className="mt-8 max-w-xl" delayChildren={0.1} stagger={0.08}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { icon: MessageCircle, label: "WhatsApp" },
                { icon: MessageSquare, label: "SMS" },
                { icon: Send, label: "Telegram" },
                { icon: Globe, label: "Web" },
              ].map((c) => (
                <motion.div
                  key={c.label}
                  variants={fadeUp(14)}
                  className="rounded-lg border border-border bg-card p-3.5"
                >
                  <c.icon className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
                  <p className="mt-2.5 text-sm font-semibold tracking-tight">{c.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Available</p>
                </motion.div>
              ))}
            </div>
          </Stagger>
          <Stagger className="mt-10 max-w-xl" stagger={0.12}>
            {steps.map((s) => (
              <motion.div key={s.t} variants={fadeUp()} className="hairline-t py-5">
                <div className="flex items-baseline gap-4">
                  <span className="font-display text-sm font-semibold text-accent tabular">{s.n}</span>
                  <div>
                    <h3 className="font-semibold tracking-tight">{s.t}</h3>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.d}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </Stagger>
        </div>

        {/* Case card: the reference's tracker, as a working example */}
        <Reveal className="lg:w-88">
          <div className="mb-6 rounded-none border-2 border-border bg-card">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              <span className="text-sm font-semibold">GamCiv Reports</span>
              <span className="ml-auto text-xs text-muted-foreground">WhatsApp</span>
            </div>
            <div className="px-5 py-5">
              <ChatFlow script={chatScript} loop />
            </div>
          </div>
          <div className="rounded-none border-2 border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <label htmlFor="case-ref" className="text-xs font-medium text-muted-foreground">
                Reference number
              </label>
              <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2.5">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  id="case-ref"
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                  placeholder="GMC-2026-00142"
                  readOnly
                  tabIndex={-1}
                />
              </div>
            </div>
            <div className="px-5 py-5">
              <p className="text-sm font-semibold">Electricity fault - Bakoteh</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Open for 3 days</p>
              <Stagger className="mt-5" delayChildren={0.2} stagger={0.35}>
                {trackerSteps.map((s, i) => (
                  <motion.div key={s.title} variants={fadeUp(14)} className="relative flex gap-3.5 pb-6 last:pb-1">
                    {i < trackerSteps.length - 1 && (
                      <span className="absolute left-[13px] top-8 bottom-0 w-px bg-border" aria-hidden="true" />
                    )}
                    {s.icon === "check" && (
                      <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                        <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    )}
                    {s.icon === "current" && (
                      <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-primary">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                    {s.icon === "pending" && (
                      <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background" aria-hidden="true" />
                    )}
                    <div className="pt-0.5">
                      <p className="text-sm font-semibold tracking-tight">
                        {s.title}
                        {s.time && <span className="ml-2 text-xs font-normal text-muted-foreground tabular">{s.time}</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
                    </div>
                  </motion.div>
                ))}
              </Stagger>
            </div>
          </div>
          <div className="mt-4 flex items-end justify-center border-t border-border pt-4">
            <PhoneCase />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
