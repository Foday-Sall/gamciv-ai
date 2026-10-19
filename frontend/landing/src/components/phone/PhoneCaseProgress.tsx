import { SCREENS } from "./shared"

/** Story-style progress segments, one per channel screen. */
export default function PhoneCaseProgress({ active }: { active: number }) {
  return (
    <div className="flex items-center gap-1 px-3 pt-2 pb-2.5">
      {SCREENS.map((s, i) => (
        <div key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={
              i < active
                ? "h-full w-full bg-white/40"
                : i === active
                  ? "phone-story-bar h-full bg-white"
                  : "h-full w-0 bg-white"
            }
          />
        </div>
      ))}
    </div>
  )
}
