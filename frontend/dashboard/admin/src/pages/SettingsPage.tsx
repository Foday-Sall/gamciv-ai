import { useEffect, useState } from "react"
import { motion, type Variants } from "framer-motion"
import { Save, BellRing, AlarmClock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/PageHeader"
import { getSettings, saveSettings, type AdminSettings } from "@/lib/adminApi"
import { toast } from "@/components/ui/toast"

const containerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0 },
}

const URGENCY_LEVELS: Array<{ key: keyof AdminSettings["escalationThresholds"]; label: string; hint: string }> = [
  { key: "critical", label: "Critical", hint: "Life safety and total outages escalate first" },
  { key: "high", label: "High", hint: "Major service disruptions" },
  { key: "medium", label: "Medium", hint: "Standard complaints" },
  { key: "low", label: "Low", hint: "Minor issues and feedback" },
]

const NOTIFICATIONS: Array<{ key: keyof AdminSettings["notifications"]; label: string; hint: string }> = [
  { key: "onEscalation", label: "On escalation", hint: "A complaint crosses its urgency threshold" },
  { key: "onSlaBreach", label: "On SLA breach", hint: "An institution misses its response window" },
  { key: "onAccountCreated", label: "On account issued", hint: "A new institutional account is created" },
  { key: "onAccessChange", label: "On access change", hint: "Access levels or limits are modified" },
  { key: "weeklyDigest", label: "Weekly digest", hint: "Summary of volume and response performance" },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getSettings().then((data) => {
      if (!cancelled) setSettings(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setThreshold = (key: keyof AdminSettings["escalationThresholds"], value: number) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            escalationThresholds: { ...current.escalationThresholds, [key]: value },
          }
        : current
    )
  }

  const setNotification = (key: keyof AdminSettings["notifications"], value: boolean) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            notifications: { ...current.notifications, [key]: value },
          }
        : current
    )
  }

  const submit = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await saveSettings(settings)
      toast({
        title: "Settings saved",
        description: "Escalation thresholds and notifications are updated.",
        variant: "success",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Escalation thresholds and notification preferences for the administrator."
      />

      {!settings ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="shown" className="space-y-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlarmClock className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  Escalation thresholds
                </CardTitle>
                <CardDescription>
                  Hours a complaint may wait before it escalates, per urgency level.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {URGENCY_LEVELS.map(({ key, label, hint }) => (
                    <div key={key} className="grid gap-2 rounded-lg border border-border p-4">
                      <Label htmlFor={`threshold-${key}`} className="text-sm">
                        {label}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`threshold-${key}`}
                          type="number"
                          min={1}
                          max={720}
                          value={settings.escalationThresholds[key]}
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            if (Number.isFinite(value) && value > 0) setThreshold(key, value)
                          }}
                          className="w-24"
                        />
                        <span className="text-xs text-muted-foreground">hours</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BellRing className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  Notifications
                </CardTitle>
                <CardDescription>What the administrator gets alerted about.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {NOTIFICATIONS.map(({ key, label, hint }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border p-4"
                    >
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{hint}</p>
                      </div>
                      <Switch
                        checked={settings.notifications[key]}
                        onCheckedChange={(checked) => setNotification(key, checked)}
                        aria-label={`Toggle notification ${label}`}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving}>
              <Save className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
              {saving ? "Saving..." : "Save settings"}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
