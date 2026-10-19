import { Skeleton } from "@/components/ui/skeleton"
import type { Institution } from "@/lib/adminApi"
import LevelBadge from "./LevelBadge"

/** Institution list in the left column: selectable rows with access badges. */
export default function InstitutionList({
  institutions,
  selectedId,
  onSelect,
}: {
  institutions: Institution[] | null
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="space-y-1">
      {(institutions ?? []).map((institution) => (
        <button
          key={institution.id}
          type="button"
          onClick={() => onSelect(institution.id)}
          className={
            "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors " +
            (selectedId === institution.id
              ? "bg-primary/12 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground")
          }
        >
          <span className="truncate">{institution.name}</span>
          <LevelBadge level={institution.accessLevel} />
        </button>
      ))}
      {!institutions ? [0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-10 w-full" />) : null}
    </div>
  )
}
