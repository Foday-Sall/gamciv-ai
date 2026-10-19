import { Layers, Save } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ALL_CATEGORIES } from "@/lib/adminApi"

/** Allowed-categories toggles for the selected institution. */
export default function CategoryToggles({
  selectedCategories,
  onToggle,
}: {
  selectedCategories: string[]
  onToggle: (category: string, checked: boolean) => void
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          <p className="text-sm font-medium">Allowed categories</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Only complaints in these categories are routed to this institution.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_CATEGORIES.map((category) => (
            <div
              key={category}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
            >
              <Label className="text-sm font-normal">{category}</Label>
              <Switch
                checked={selectedCategories.includes(category)}
                onCheckedChange={(checked) => onToggle(category, checked)}
                aria-label={`Toggle category ${category}`}
              />
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Save className="h-3.5 w-3.5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          Changes save immediately and appear in the audit log.
        </p>
      </CardContent>
    </Card>
  )
}
