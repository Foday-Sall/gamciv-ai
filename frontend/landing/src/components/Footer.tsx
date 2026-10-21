import { CheckCircle2, ExternalLink, Mail, MapPin, MessageSquare, Route } from "lucide-react"
import GambiaFlag from "@/components/GambiaFlag"
import gamfixLogo from "@/assets/gamfix-logo.png"

/* Footer: three-column grid on the brand's hairline discipline.
   LEFT: brand block stacked on a flex column: logo + wordmark, the service
   line, then a letterspaced kicker of the four action words, each led by a
   small clay-tone Lucide icon, and a muted PocketSoftware line beneath.
   MIDDLE: in-page routing links under a small heading. RIGHT: legal routes
   and contact. Bottom row: copyright left, a national sign-off right.
   Sharp edges, no emojis, no em dashes. */
const VERBS: Array<[typeof MessageSquare, string]> = [
  [MessageSquare, "Report"],
  [Route, "Route"],
  [MapPin, "Track"],
  [CheckCircle2, "Resolve"],
]

export default function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_0.9fr] md:gap-8">
          {/* Brand block: stacked composition, the four verbs as a kicker row */}
          <div className="flex max-w-sm flex-col gap-3.5">
            <a href="/" className="flex items-center" aria-label="GamFix home">
              <img src={gamfixLogo} alt="GamFix" className="h-9 w-auto max-w-[150px] object-contain" draggable={false} />
            </a>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A public complaints service for The Gambia.
            </p>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold uppercase tracking-widest text-foreground">
              {VERBS.map(([Icon, verb]) => (
                <span key={verb} className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  {verb}.
                </span>
              ))}
            </p>
            <p className="text-xs text-muted-foreground">A PocketSoftware service.</p>
          </div>

          {/* In-page routing */}
          <nav aria-label="Site sections">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-foreground">Site</h2>
            <ul className="mt-3.5 space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#how" className="hover:text-foreground">How it works</a>
              </li>
              <li>
                <a href="#track" className="hover:text-foreground">Track a report</a>
              </li>
              <li>
                <a href="#institutions" className="hover:text-foreground">Institutions</a>
              </li>
            </ul>
          </nav>

          {/* Legal routes and contact */}
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-foreground">Legal &amp; contact</h2>
            <ul className="mt-3.5 space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="/privacy" className="inline-flex items-center gap-2 hover:text-foreground">
                  <ExternalLink className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  Privacy
                </a>
              </li>
              <li>
                <a href="/terms" className="inline-flex items-center gap-2 hover:text-foreground">
                  <ExternalLink className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  Terms
                </a>
              </li>
              <li>
                <a href="mailto:hello@pocketsoftware.dev" className="inline-flex items-center gap-2 hover:text-foreground">
                  <Mail className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  hello@pocketsoftware.dev
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom row: copyright and national sign-off */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[13px] text-muted-foreground">
          <span>&copy; 2026 GamFix. All rights reserved.</span>
          <span className="inline-flex items-center gap-2">
            <GambiaFlag className="h-3 w-auto rounded-[1px]" aria-hidden="true" />
            Made for The Gambia
          </span>
        </div>
      </div>
    </footer>
  )
}
