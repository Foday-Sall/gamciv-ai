import { useCallback, useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Shield } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/PageHeader"
import {
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
import InstitutionList from "@/pages/access-control/InstitutionList"
import LimitInputs from "@/pages/access-control/LimitInputs"
import CategoryToggles from "@/pages/access-control/CategoryToggles"

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
            <InstitutionList institutions={institutions} selectedId={selectedId} onSelect={setSelectedId} />
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

              <LimitInputs
                limits={{ slaHours: limits.slaHours, maxPerDay: limits.maxPerDay }}
                onChangeSla={(hours) => void changeSla(hours)}
                onChangeRate={(maxPerDay) => void changeRate(maxPerDay)}
              />

              <CategoryToggles
                selectedCategories={limits.allowedCategories}
                onToggle={toggleCategory}
              />
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
