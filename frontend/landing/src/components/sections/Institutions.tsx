import { Reveal } from "@/components/sections/shared"

const institutions = [
  {
    name: "KMC",
    full: "Kanifing Municipal Council",
    logo: "/logos/kmc.png",
    body: "Flooded drains, uncollected rubbish, broken roads and public infrastructure across Serrekunda, Bundung, Bakoteh and the Kairaba corridor.",
  },
  {
    name: "NAWEC",
    full: "National Water and Electricity Company",
    logo: "/logos/nawec.png",
    body: "Water that never comes, sewerage that overflows, blackouts and unsafe connections: the faults that disrupt whole neighbourhoods.",
  },
  {
    name: "NRA",
    full: "National Roads Authority",
    logo: "/logos/nra.png",
    body: "Potholes deep enough to break an axle, washed-out shoulders, missing signs and hazards on the highways.",
  },
  {
    name: "NEA",
    full: "National Environment Agency",
    logo: "/logos/nea.png",
    body: "Illegal dumping in the mangroves, burning waste, polluted water and threats to public health.",
  },
  {
    name: "Police",
    full: "Gambia Police Force, through the central desk",
    logo: "/logos/police.png",
    body: "Abandoned vehicles, unsafe public spaces and neighbourhood security concerns. In an emergency, call 117 directly.",
  },
]

/* Institutions */
export default function Institutions() {
  return (
    <section id="institutions" className="hairline-b scroll-mt-24 bg-card" aria-labelledby="inst-heading">
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <h2 id="inst-heading" className="max-w-xl text-balance text-3xl font-semibold tracking-tight font-display md:text-4xl">
          Reports go to the office that can act
        </h2>
        <p className="mt-4 max-w-xl text-muted-foreground">
          Every report is matched to the authority responsible for that problem and that location. If it lands
          with the wrong desk, it is forwarded on with a note.
        </p>
        <Reveal className="mt-10 max-w-3xl">
          <div className="hairline-t">
            {institutions.map((inst) => (
              <div key={inst.name} className="hairline-t flex items-start gap-4 py-6">
                <img
                  src={inst.logo}
                  alt={`${inst.name} logo`}
                  width={40}
                  height={40}
                  loading="lazy"
                  className="h-10 w-10 shrink-0 border border-clay-line bg-white object-contain p-0.5"
                />
                <div className="min-w-0">
                  <p className="font-semibold tracking-tight">
                    {inst.name}
                    <span className="ml-2 text-[13px] font-normal text-muted-foreground">{inst.full}</span>
                  </p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{inst.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
