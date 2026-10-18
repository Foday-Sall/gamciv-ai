import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { EASE } from "@/components/sections/shared"

/* National three-beat headline, per the Caserta/Allentown civic pattern:
   short declarative beats, the last one (the outcome) carried by the service
   green. Word-by-word reveal, disabled under reduced motion. */
const HEADLINE_WORDS = [
  { w: "Your", beat: false },
  { w: "street.", beat: false },
  { w: "Your", beat: false },
  { w: "report.", beat: false },
  { w: "Your", beat: false },
  { w: "fix.", beat: true },
]

export default function AnimatedHeadline() {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (reduce) {
      setShown(HEADLINE_WORDS.length)
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    HEADLINE_WORDS.forEach((_, i) => {
      timers.push(setTimeout(() => setShown(i + 1), 350 + i * 110))
    })
    return () => timers.forEach(clearTimeout)
  }, [reduce])

  return (
    <h1 className="max-w-2xl text-balance text-5xl font-bold leading-[1.02] tracking-tight font-display sm:text-6xl md:text-7xl">
      {HEADLINE_WORDS.map((word, i) => (
        <motion.span
          key={i}
          className={"inline-block " + (word.beat ? "text-accent" : "")}
          initial={reduce ? false : { opacity: 0, filter: "blur(12px)", y: 26 }}
          animate={shown > i ? { opacity: 1, filter: "blur(0px)", y: 0 } : undefined}
          transition={{ duration: 0.65, ease: EASE }}
        >
          {word.w}&nbsp;
        </motion.span>
      ))}
    </h1>
  )
}
