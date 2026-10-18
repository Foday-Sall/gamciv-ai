import { useEffect, useRef, useState } from "react"
import { animate, useInView, useReducedMotion } from "motion/react"
import { Info } from "lucide-react"
import { Reveal } from "@/components/sections/shared"

/* Count-up number: eases from 0 to `value` when the element scrolls into view. */
function AnimatedCounter({ value, duration = 1.4 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      setDisplay(value)
      return
    }
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    })
    return () => controls.stop()
  }, [inView, value, duration, reduce])

  return <span ref={ref}>{display.toLocaleString("en-US")}</span>
}

const stats = [
  { value: 1200, label: "Reports logged", note: "this month" },
  { value: 740, label: "Resolved", note: "62% of all reports" },
  { value: 48, label: "Median first response", note: "avg 2.1 days to fix" },
  { value: 18, label: "Institutions receiving reports", note: "5 national, 13 municipal" },
]

/* Stats: a full-bleed navy transparency band - the Caserta/WorlGov ledger
   pattern. Plain tabular figures separated by hairline rules, white on navy.
   Same numbers, presented as a public ledger instead of cards. */
export default function Stats() {
  return (
    <section id="stats" aria-labelledby="stats-heading" className="bg-primary text-white">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-20">
        <Reveal>
          <h2 id="stats-heading" className="max-w-xl text-balance text-2xl font-semibold tracking-tight font-display md:text-3xl">
            What the line has handled so far
          </h2>
        </Reveal>
        <Reveal delay={0.05}>
          <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4 md:gap-x-10">
            {stats.map((s, i) => (
              <div key={s.label} className={"border-blue-300/30 " + (i > 0 ? "border-l pl-5 md:pl-6" : "")}>
                <p className="font-display text-5xl font-semibold tracking-tight tabular">
                  <AnimatedCounter value={s.value} />
                </p>
                <p className="mt-3 text-sm font-medium text-blue-100">{s.label}</p>
                <p className="mt-1 text-xs text-blue-200">{s.note}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-9 flex items-center gap-1.5 text-xs text-blue-200">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Figures are pilot placeholders pending the live statistics feed.
          </p>
        </Reveal>
        <p id="coverage" className="sr-only">Coverage</p>
      </div>
    </section>
  )
}
