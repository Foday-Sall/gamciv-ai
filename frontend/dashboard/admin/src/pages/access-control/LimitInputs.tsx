import { Clock, Gauge } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

/** SLA hours and daily rate-limit numeric inputs, side by side. */
export default function LimitInputs({
  limits,
  onChangeSla,
  onChangeRate,
}: {
  limits: { slaHours: number; maxPerDay: number }
  onChangeSla: (hours: number) => void
  onChangeRate: (maxPerDay: number) => void
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
            <p className="text-sm font-medium">SLA hours</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Hours allowed before a complaint escalates for this institution.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={240}
              value={limits.slaHours}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value > 0) onChangeSla(value)
              }}
              className="w-28"
              aria-label="SLA hours"
            />
            <span className="text-sm text-muted-foreground">hours per complaint</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
            <p className="text-sm font-medium">Max complaints per day</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Daily intake cap applied to this institution's account.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Input
              type="number"
              min={0}
              max={500}
              value={limits.maxPerDay}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value >= 0) onChangeRate(value)
              }}
              className="w-28"
              aria-label="Max complaints per day"
            />
            <span className="text-sm text-muted-foreground">complaints / day</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
