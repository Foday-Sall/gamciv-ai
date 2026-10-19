import { MessageSquare, Route, MapPin, CheckCircle2, Mail, ExternalLink } from "lucide-react"
import GamCivMark from "@/components/GamCivMark"
import GambiaFlag from "@/components/GambiaFlag"

/* Footer: three-column grid on the brand's hairline discipline.
   LEFT: logo + service description with the four action words carried by
   small clay-tone Lucide icons. MIDDLE: in-page routing links under a small
   heading. RIGHT: legal routes and contact. Bottom row: copyright left,
   a national sign-off right. Sharp edges, no emojis, no em dashes. */
export default function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_0.9fr] md:gap-8">
          {/* Brand: description with the service's four verbs as icons */}
          <div className="max-w-sm">
            <a href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight font-display">
              <GamCivMark />
              GamCiv
            </a>
            <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
              A public complaints service for The Gambia.{" "}
              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 align-baseline">
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  Report,
                </span>
                <span className="inline-flex items-center gap-1">
                  <Route className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  route,
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  track,
                </span>
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-clay" strokeWidth={1.75} aria-hidden="true" />
                  resolve.
                </span>
              </span>{" "}
              A PocketSoftware service.
            </p>
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
          <span>&copy; 2026 GamCiv. All rights reserved.</span>
          <span className="inline-flex items-center gap-2">
            <GambiaFlag className="h-3 w-auto rounded-[1px]" aria-hidden="true" />
            Made for The Gambia
          </span>
        </div>
      </div>
    </footer>
  )
}
