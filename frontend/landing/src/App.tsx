import { useEffect } from "react"
import { useReducedMotion } from "motion/react"
import Header from "@/components/Header"
import Footer from "@/components/Footer"
import Hero from "@/components/sections/Hero"
import ReportCategories from "@/components/sections/ReportCategories"
import HowItWorks from "@/components/sections/HowItWorks"
import Institutions from "@/components/sections/Institutions"
import Stats from "@/components/sections/Stats"
import CTA from "@/components/sections/CTA"

export default function App() {
  const reduce = useReducedMotion()

  // Anchor tags that already carry scroll-behavior: smooth get used on load
  // only when the URL has a hash; otherwise nothing to do.
  useEffect(() => {
    if (window.location.hash) {
      const el = document.querySelector(window.location.hash)
      if (el) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth" })
    }
  }, [reduce])

  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <Header />

      <main id="main">
        <Hero reduce={reduce} />
        <ReportCategories />
        <HowItWorks />
        <Institutions />
        <Stats />
        <CTA />
      </main>

      <Footer />
    </div>
  )
}
