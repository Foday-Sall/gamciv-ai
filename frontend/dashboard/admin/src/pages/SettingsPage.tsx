import { useEffect, useMemo, useState } from "react"
import { motion, type Variants } from "framer-motion"
import {
  Save,
  BellRing,
  AlarmClock,
  KeyRound,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/PageHeader"
import { toast } from "@/components/ui/toast"
import { getSettings, saveSettings, type AdminSettings } from "@/lib/adminApi"
import {
  listSecrets,
  getSecretsStatus,
  setSecret,
  deleteSecret,
  type SecretEntry,
} from "@/lib/adminApi"

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

// Keys the panel knows about, in display order. Custom keys appear after.
const KNOWN_KEYS: Array<{ key: string; label: string; hint: string }> = [
  { key: "RESEND_API_KEY", label: "Resend API key", hint: "Email delivery (RESEND_API_KEY)" },
  { key: "RESEND_FROM", label: "Resend from address", hint: "Sender identity, e.g. GamCiv <noreply@domain>" },
  { key: "AI_API_KEY", label: "AI provider API key", hint: "Classification model access" },
  { key: "AI_BASE_URL", label: "AI base URL", hint: "OpenAI-compatible endpoint" },
  { key: "AI_MODEL", label: "AI model", hint: "Model name at the provider" },
  { key: "GOWA_BASIC_AUTH", label: "GOWA basic auth", hint: "user:password for the WhatsApp gateway" },
  { key: "GOWA_BASE_URL", label: "GOWA base URL", hint: "Gateway REST endpoint" },
  { key: "GOWA_WEBHOOK_SECRET", label: "GOWA webhook secret", hint: "Shared HMAC for inbound webhooks" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", hint: "From BotFather" },
  { key: "TELEGRAM_WEBHOOK_SECRET", label: "Telegram webhook secret", hint: "X-Telegram-Bot-Api-Secret-Token check" },
]

const CUSTOM_KEY_PATTERN = /^CUSTOM_[A-Z0-9_]{1,40}$/

/** One editable secret row: masked input, show toggle, save, delete. */
function SecretRow({
  label,
  hint,
  entry,
  onSave,
  onDelete,
  busy,
}: {
  label: string
  hint: string
  entry: SecretEntry | undefined
  onSave: (value: string) => Promise<void>
  onDelete: () => Promise<void>
  busy: boolean
}) {
  const [value, setValue] = useState("")
  const [reveal, setReveal] = useState(false)
  const isSet = entry?.set ?? false

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${isSet ? "bg-ok" : "bg-muted-foreground/40"}`}
            />
            <Label className="text-sm font-medium">{label}</Label>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className={`shrink-0 text-xs ${isSet ? "text-ok" : "text-muted-foreground"}`}>
          {isSet ? "Set" : "Not set"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={isSet ? "Saved. Type a new value to replace it." : "Enter value"}
            autoComplete="off"
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setReveal((current) => !current)}
            aria-label={reveal ? "Hide value" : "Show value"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button onClick={() => onSave(value)} disabled={busy || value.length === 0}>
          <Save className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          Save
        </Button>
        {isSet ? (
          <Button variant="outline" onClick={() => onDelete()} disabled={busy}>
            <Trash2 className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function SecretsCard() {
  const [entries, setEntries] = useState<SecretEntry[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [customKey, setCustomKey] = useState("")
  const [pendingKeys, setPendingKeys] = useState<string[]>([])
  const [reload, setReload] = useState<"idle" | "waiting" | "confirmed">("idle")

  const refresh = async () => {
    try {
      const list = await listSecrets()
      setEntries(list)
    } catch (error) {
      toast({
        title: "Could not load secrets",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  useEffect(() => {
    let cancelled = false
    listSecrets()
      .then((list) => {
        if (!cancelled) setEntries(list)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const entryFor = (key: string) => entries?.find((entry) => entry.key === key)

  const confirmReload = async () => {
    setReload("waiting")
    // The bridge recreates the container right after saving; wait, then check.
    await new Promise((resolve) => setTimeout(resolve, 5000))
    try {
      const status = await getSecretsStatus()
      if (status.lastReloadOk === false) {
        setReload("idle")
        toast({
          title: "Reload failed",
          description: "The functions container did not come back healthy. Check the VPS logs.",
          variant: "destructive",
        })
      } else {
        setReload("confirmed")
      }
    } catch {
      setReload("idle")
    }
    await refresh()
  }

  const save = async (key: string, value: string) => {
    setBusyKey(key)
    try {
      await setSecret(key, value)
      toast({
        title: "Saved. Functions reloading...",
        description: `${key} is being applied to the runtime.`,
        variant: "success",
      })
      void confirmReload()
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setBusyKey(null)
    }
  }

  const remove = async (key: string) => {
    setBusyKey(key)
    try {
      await deleteSecret(key)
      toast({
        title: "Cleared. Functions reloading...",
        description: `${key} was removed from the runtime.`,
      })
      void confirmReload()
    } catch (error) {
      toast({
        title: "Clear failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setBusyKey(null)
    }
  }

  const customValid = useMemo(() => CUSTOM_KEY_PATTERN.test(customKey), [customKey])
  const customEntries = (entries ?? []).filter((entry) => entry.key.startsWith("CUSTOM_"))
  const pendingEntries: SecretEntry[] = pendingKeys
    .filter((key) => !customEntries.some((entry) => entry.key === key))
    .map((key) => ({ key, set: false, updatedAt: null }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          API keys and secrets
        </CardTitle>
        <CardDescription>
          Stored on the server only, never in the database or the browser. Saving reloads the
          functions runtime so new values apply immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!entries ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {KNOWN_KEYS.map((known) => (
              <SecretRow
                key={known.key}
                label={known.label}
                hint={known.hint}
                entry={entryFor(known.key)}
                onSave={(value) => save(known.key, value)}
                onDelete={() => remove(known.key)}
                busy={busyKey === known.key}
              />
            ))}

            {customEntries.length > 0 || pendingEntries.length > 0 ? (
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Custom keys
              </p>
            ) : null}
            {pendingEntries.map((entry) => (
              <SecretRow
                key={entry.key}
                label={entry.key}
                hint="New key - enter its value and save"
                entry={entry}
                onSave={(value) => save(entry.key, value)}
                onDelete={() => remove(entry.key)}
                busy={busyKey === entry.key}
              />
            ))}
            {customEntries.map((entry) => (
              <SecretRow
                key={entry.key}
                label={entry.key}
                hint="Custom key"
                entry={entry}
                onSave={(value) => save(entry.key, value)}
                onDelete={() => remove(entry.key)}
                busy={busyKey === entry.key}
              />
            ))}

            <div className="rounded-lg border border-dashed border-border p-4">
              <Label htmlFor="custom-key" className="text-sm">
                Add a custom key
              </Label>
              <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                Uppercase with underscores, starts with CUSTOM_. Example: CUSTOM_SMS_SENDER
              </p>
              <div className="flex items-center gap-2">
                <Input
                  id="custom-key"
                  value={customKey}
                  onChange={(event) => setCustomKey(event.target.value.toUpperCase())}
                  placeholder="CUSTOM_NAME"
                  className="max-w-xs font-mono text-sm"
                  autoComplete="off"
                />
                <Button
                  variant="outline"
                  disabled={!customValid}
                  onClick={() => {
                    if (!pendingKeys.includes(customKey)) {
                      setPendingKeys((current) => [...current, customKey])
                    }
                    setCustomKey("")
                  }}
                >
                  <Plus className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  Add
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                {reload === "confirmed"
                  ? "Reload confirmed."
                  : reload === "waiting"
                    ? "Waiting for the functions runtime..."
                    : ""}
              </span>
              <Button variant="ghost" onClick={() => void refresh()}>
                <RefreshCw className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

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

          <motion.div variants={itemVariants}>
            <SecretsCard />
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
