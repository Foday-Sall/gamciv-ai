import { motion } from "motion/react"
import {
  Droplets,
  Zap,
  Route,
  Trash2,
  ShieldAlert,
  Shapes,
  ImagePlus,
} from "lucide-react"
import { Stagger, Reveal, fadeUp } from "@/components/sections/shared"

const categories = [
  { icon: Droplets, label: "Water", example: "Dry taps, broken pipes, no water for days" },
  { icon: Zap, label: "Electricity", example: "Blackouts, sparks, fallen lines" },
  { icon: Route, label: "Roads", example: "Potholes that swallow tyres" },
  { icon: Trash2, label: "Waste", example: "Rubbish piling where children play" },
  { icon: ShieldAlert, label: "Safety", example: "Dark streets, open manholes" },
  { icon: Shapes, label: "Other", example: "If it endangers the public, report it" },
]

/* What you can report: category tiles from the reference */
export default function ReportCategories() {
  return (
    <section className="hairline-b bg-card" aria-labelledby="report-heading">
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <Reveal>
          <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-tight font-display md:text-4xl">
            What can you report
          </h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            If it endangers the public or disrupts daily life, it belongs here. One photo and one sentence is a complete report.
          </p>
        </Reveal>
        <Stagger className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" delayChildren={0.1} stagger={0.06}>
          {categories.map((c) => (
            <motion.div
              key={c.label}
              variants={fadeUp(16)}
              className="rounded-lg border border-border bg-background p-4 transition-colors duration-200 hover:border-steel hover:tile-wash"
            >
              <c.icon className="h-5 w-5 text-steel" strokeWidth={1.75} aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold tracking-tight">{c.label}</p>
              <p className="mt-1 text-xs leading-snug text-slate-500">{c.example}</p>
            </motion.div>
          ))}
        </Stagger>
        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-col gap-4 rounded-xl border border-border bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-steel-line bg-background text-steel">
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-sm text-muted-foreground">
                A photo, a location, a sentence. That is a complete report.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
