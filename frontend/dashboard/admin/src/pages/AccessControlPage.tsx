import { useCallback, useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Shield, Save, Layers, Clock, Gauge } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/PageHeader"
import {
  ALL_CATEGORIES,
  getAccessLimits,
  getInstitutions,
  setAccessLevel,
  setAllowedCategories,
  setRateLimit,
  setSlaHours,
  type AccessLimits,
  type Institution,
} from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"

function LevelBadge({ level }: { level: AccessLimits["accessLevel"] }) {
  const variant = level === "full" ? "success" : level === "restricted" ? "warning" : "info"
  return <Badge variant={variant}>{level}</Badge>
}

export default function AccessControlPage() {
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [limits, setLimits] = useState<AccessLimits | null>(null)
  const [, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getInstitutions().then((data) => {
      if (cancelled) return
      setInstitutions(data)
      if (data.length > 0) setSelectedId(data[0].id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadLimits = useCallback(async (institutionId: string) => {
    const data = await getAccessLimits(institutionId)
    setLimits(data)
  }, [])

  useEffect(() => {
    if (selectedId) void loadLimits(selectedId)
  }, [selectedId, loadLimits])

  const persist = async (
    action: () => Promise<void>,
    key: string,
    title: string,
    description: string
  ) => {
    setSaving(key)
    try {
      await action()
      toast({ title, description, variant: "success" })
    } finally {
      setSaving(null)
    }
  }

  const changeLevel = async (level: AccessLimits["accessLevel"]) => {
    if (!selectedId || !limits) return
    const next: AccessLimits = { ...limits, accessLevel: level }
    setLimits(next)
    await persist(
      () => setAccessLevel(selectedId, level),
      "level",
      "Access level saved",
      "The institution sees this level on next sign-in."
    )
  }

  const changeCategories = async (categories: string[]) => {
    if (!selectedId || !limits) return
    const next: AccessLimits = { ...limits, allowedCategories: categories }
    setLimits(next)
    await persist(
      () => setAllowedCategories(selectedId, categories),
      "categories",
      "Categories saved",
      "Routing respects the updated category scope immediately."
    )
  }

  const changeSla = async (hours: number) => {
    if (!selectedId || !limits) return
    const next: AccessLimits = { ...limits, slaHours: hours }
    setLimits(next)
    await persist(
      () => setSlaHours(selectedId, hours),
      "sla",
      "SLA hours saved",
      "Escalation timers use the new threshold."
    )
  }

  const changeRate = async (maxPerDay: number) => {
    if (!selectedId || !limits) return
    const next: AccessLimits = { ...limits, maxPerDay }
    setLimits(next)
    await persist(
      () => setRateLimit(selectedId, maxPerDay),
      "rate",
      "Rate limit saved",
      "Complaint intake is capped at the new daily maximum."
    )
  }

  const toggleCategory = (category: string, checked: boolean) => {
    if (!limits) return
    const categories = checked
      ? [...limits.allowedCategories, category]
      : limits.allowedCategories.filter((entry) => entry !== category)
    void changeCategories(categories)
  }

  const selectedInstitution = (institutions ?? []).find((entry) => entry.id === selectedId)

  return (
    <div>
      <PageHeader
        title="Access Control"
        description="What each institution's account may see and do. Every limit here is granted by the administrator."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardContent className="p-3">
            <p className="px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Institutions
            </p>
            <div className="space-y-1">
              {(institutions ?? []).map((institution) => (
                <button
                  key={institution.id}
                  type="button"
                  onClick={() => setSelectedId(institution.id)}
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
              {!institutions
                ? [0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-10 w-full" />)
                : null}
            </div>
          </CardContent>
        </Card>

        <AnimatePresence mode="wait">
          {limits && selectedInstitution ? (
            <motion.div
              key={limits.institutionId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <Card>
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-semibold">{selectedInstitution.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        Access level selected by the administrator
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Shield className="h-4 w-4 text-muted-foreground" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                      <Select
                        value={limits.accessLevel}
                        onValueChange={(value) =>
                          void changeLevel(value as AccessLimits["accessLevel"])
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Full</SelectItem>
                          <SelectItem value="restricted">Restricted</SelectItem>
                          <SelectItem value="view-only">View only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

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
                          if (Number.isFinite(value) && value > 0) void changeSla(value)
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
                          if (Number.isFinite(value) && value >= 0) void changeRate(value)
                        }}
                        className="w-28"
                        aria-label="Max complaints per day"
                      />
                      <span className="text-sm text-muted-foreground">complaints / day</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

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
                          checked={limits.allowedCategories.includes(category)}
                          onCheckedChange={(checked) => toggleCategory(category, checked)}
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
            </motion.div>
          ) : (
            <motion.div key="skeleton" exit={{ opacity: 0 }}>
              <Card>
                <CardContent className="space-y-3 p-6">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-40 w-full" />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
