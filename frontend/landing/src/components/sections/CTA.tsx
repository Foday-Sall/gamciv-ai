import GambiaFlag from "@/components/GambiaFlag"
import { Button } from "@/components/ui/button"
import { Lift, Reveal } from "@/components/sections/shared"

/* Final CTA: one primary action (the task), reassurance strip below. */
export default function CTA() {
  return (
    <section id="report" className="scroll-mt-24" aria-labelledby="cta-heading">
      <div className="mx-auto max-w-2xl px-5 py-24 text-center md:px-8">
        <Reveal>
          <h2 id="cta-heading" className="text-balance text-3xl font-semibold tracking-tight font-display md:text-4xl">
            See something broken where you live?
          </h2>
          <p className="mt-4 text-muted-foreground">
            The GamCiv app is coming soon. Sign up to be told when it is live in your area.
          </p>
          <Lift className="mt-8 inline-block">
            <Button asChild size="lg">
              <a href="mailto:hello@pocketsoftware.dev?subject=GamCiv%20signup">Get early access</a>
            </Button>
          </Lift>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            <GambiaFlag className="h-3 w-auto rounded-[1px]" aria-hidden="true" />
            Free to use. No account needed. Works on any phone.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
