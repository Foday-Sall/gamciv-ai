import { motion } from "motion/react"
import PhoneCase from "@/components/PhoneCase"
import AnimatedHeadline from "@/components/AnimatedHeadline"
import GambiaFlag from "@/components/GambiaFlag"
import { Button } from "@/components/ui/button"
import { EASE, fadeUp } from "@/components/sections/shared"

/* Hero: split layout, chat is the centerpiece. Eyebrow is national (flag +
   republic line), the lead is a plain-language definition with the key phrase
   accented in service green (NFIP definition pattern). */
export default function Hero({ reduce }: { reduce: boolean | null }) {
  return (
    <section className="hairline-b">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          initial={reduce ? false : "hidden"}
          animate={reduce ? undefined : "show"}
          variants={{ hidden: {}, show: { transition: { delayChildren: 0.05, staggerChildren: 0.1 } } }}
        >
          <motion.p variants={fadeUp(16)} className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <GambiaFlag className="h-3.5 w-auto rounded-[1px]" />
            Republic of The Gambia
          </motion.p>
          <div className="mt-5">
            <AnimatedHeadline />
          </div>
          <motion.p variants={fadeUp()} className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            You see the problem every day — the flooded drain, the dark street, the pipe that never gets fixed. You should not need to know which office owns it.{" "}
            <span className="bg-accent/10 font-semibold text-foreground box-decoration-clone px-1">
              Send one WhatsApp message, a photo and a sentence, and the case is opened, routed and pushed until it is done.
            </span>
          </motion.p>
          <motion.div variants={fadeUp()} className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="#report">Get early access</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#how">See how it works</a>
            </Button>
          </motion.div>
          <motion.p variants={fadeUp()} className="mt-6 text-sm text-muted-foreground">
            Free to use. No account needed. Works on any phone.
          </motion.p>
        </motion.div>

        {/* The phone story: one case across four channels, cycling live */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.3 }}
          className="flex flex-col items-center"
        >
          <PhoneCase />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            One report, four channels: WhatsApp, SMS, Telegram, Web.
          </p>
        </motion.div>
      </div>
    </section>
  )
}
