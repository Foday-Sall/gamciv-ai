import GamCivMark from "@/components/GamCivMark"

export default function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-xs">
            <a href="/" className="flex items-center gap-2 font-bold tracking-tight font-display">
              <GamCivMark />
              GamCiv
            </a>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A public complaints service for The Gambia. Report, route, track, resolve. A PocketSoftware service.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-7 gap-y-2.5 text-sm text-muted-foreground" aria-label="Footer">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#track" className="hover:text-foreground">Track a report</a>
            <a href="#institutions" className="hover:text-foreground">Institutions</a>
            <a href="/privacy" className="hover:text-foreground">Privacy</a>
            <a href="/terms" className="hover:text-foreground">Terms</a>
            <a href="mailto:hello@pocketsoftware.dev" className="hover:text-foreground">hello@pocketsoftware.dev</a>
          </nav>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[13px] text-muted-foreground">
          <span>&copy; 2026 GamCiv. All rights reserved.</span>
          <span>The Gambia</span>
        </div>
      </div>
    </footer>
  )
}
