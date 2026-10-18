
import GamCivMark from "@/components/GamCivMark"

type PageKind = "privacy" | "terms"

const content = {
  privacy: {
    title: "Privacy Policy",
    updated: "Last updated: 18 October 2026",
    intro:
      "GamCiv is a public complaints service for The Gambia, operated by PocketSoftware. This policy explains what information we collect when you submit a report, why we collect it, and what happens to it. The short version: we collect what is needed to handle your report, nothing more, and we do not sell your data.",
    sections: [
      {
        h: "What we collect",
        p: [
          "When you send a report we keep the content of your message - text, photos and any location you share - plus the phone number you write from, so we can reply in the same chat and keep your reports linked. We also keep the reference number, the status history of your case, and which institution received it.",
        ],
      },
      {
        h: "How it is used",
        p: [
          "Your report and contact details are used to log, route and track your case, and to communicate with you about it. Report content may be shared with the institution responsible for the issue - for example the Kanifing Municipal Council, NAWEC, the National Roads Authority, the National Environment Agency or the Gambia Police Force - so they can investigate and resolve it.",
          "We do not use your report for advertising and we do not sell or rent your data to anyone.",
        ],
      },
      {
        h: "How long we keep it",
        p: [
          "Report content and status history are retained for up to 24 months to allow follow-up and quality review, after which personal identifiers are removed or the record is deleted. You can request deletion of your report and personal data at any time by writing to hello@pocketsoftware.dev with your reference number.",
        ],
      },
      {
        h: "Security and your rights",
        p: [
          "Data is encrypted in transit and at rest. You may ask for a copy of the data we hold about you, ask us to correct it, or ask us to delete it, by writing to hello@pocketsoftware.dev; we will respond within 30 days.",
          "Questions about this policy can be sent to the same address.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "Last updated: 18 October 2026",
    intro:
      "These terms govern your use of GamCiv, a public complaints service for The Gambia operated by PocketSoftware. By sending a report to the GamCiv WhatsApp line or contacting us, you agree to these terms.",
    sections: [
      {
        h: "What GamCiv does",
        p: [
          "GamCiv receives reports about public problems, routes them to the institution responsible, and tracks them to resolution. It is a communication and triage service: we pass your report on and keep you informed. We do not have the power to compel any institution to act, and a routed report is not a guarantee of action or a legal filing.",
        ],
      },
      {
        h: "Your responsibilities",
        p: [
          "Please report in good faith. Do not send false reports, content that is defamatory, threatening or unlawful, or anything that is not about a genuine public problem. Do not use the service for emergencies - if life or property is in danger, contact the police directly on 117 or the emergency services.",
          "We may suspend users who abuse the service.",
        ],
      },
      {
        h: "Availability and liability",
        p: [
          "The service is provided as is, without warranties of any kind, and may change or be suspended without notice. To the fullest extent permitted by law, PocketSoftware is not liable for the outcome of any report, the actions or inaction of any institution, or any loss arising from use of the service.",
        ],
      },
      {
        h: "Contact",
        p: [
          "Questions about these terms, or a report you want followed up, can be sent to hello@pocketsoftware.dev. Please include your reference number when writing about a case.",
        ],
      },
    ],
  },
} as const

export default function Legal({ page }: { page: PageKind }) {
  const c = content[page]
  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
          <a href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight font-display">
            <GamCivMark />
            GamCiv
          </a>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex" aria-label="Main">
            <a href="/#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="/#institutions" className="transition-colors hover:text-foreground">Institutions</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-16 md:px-8">
        <h1 className="text-3xl font-semibold tracking-tight font-display md:text-4xl">{c.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{c.updated}</p>
        <hr className="mt-6 border-border" />
        <div className="mt-8 space-y-8">
          <p className="leading-relaxed text-muted-foreground">{c.intro}</p>
          {c.sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-xl font-semibold tracking-tight font-display">{s.h}</h2>
              {s.p.map((para, i) => (
                <p key={i} className="mt-3 leading-relaxed text-muted-foreground">
                  {para}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>

      <footer className="mt-12 border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-2 font-bold tracking-tight font-display">
              <GamCivMark />
              GamCiv
            </a>
            <nav className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-muted-foreground" aria-label="Footer">
              <a href="/" className="hover:text-foreground">Home</a>
              <a href={page === "privacy" ? "/terms" : "/privacy"} className="hover:text-foreground">
                {page === "privacy" ? "Terms" : "Privacy"}
              </a>
              <a href="mailto:hello@pocketsoftware.dev" className="hover:text-foreground">
                hello@pocketsoftware.dev
              </a>
            </nav>
          </div>
          <p className="mt-8 text-[13px] text-muted-foreground">&copy; 2026 GamCiv. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
