import GambiaFlag from "@/components/GambiaFlag"
import { BatteryMedium, Signal, Wifi } from "lucide-react"

/** Screen top: camera dots, looping pill and Gambia flag. The pill is a plain
 *  box when motion is reduced. */
export default function PhoneCaseTop({ flag }: { flag: "full" | "dim" }) {
  return (
    <div className="px-3 pt-2.5 pb-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-1 rounded-full bg-zinc-600" />
          <span className="inline-block h-1 w-1 rounded-full bg-zinc-600" />
        </div>
        {flag === "dim" ? (
          <div className="h-4 w-20 rounded-full bg-zinc-800" />
        ) : (
          <div className="phone-pill h-4 rounded-full bg-zinc-800" />
        )}
        <GambiaFlag className="h-2.5 w-auto rounded-[1px]" />
      </div>
    </div>
  )
}

/** Status bar: clock and signal, wifi and battery icons. */
export function PhoneCaseStatusBar() {
  return (
    <div className="flex items-center justify-between px-3 pb-1">
      <span className="text-[7px] font-semibold text-zinc-400">09:41</span>
      <div className="flex items-center gap-1 text-zinc-500">
        <Signal className="h-1.5 w-1.5" />
        <Wifi className="h-1.5 w-1.5" />
        <BatteryMedium className="h-1.5 w-1.5" />
      </div>
    </div>
  )
}
