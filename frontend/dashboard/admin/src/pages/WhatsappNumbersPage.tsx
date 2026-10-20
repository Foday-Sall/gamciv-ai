import { useCallback, useEffect, useRef, useState } from "react"
import { motion, type Variants } from "framer-motion"
import {
  Smartphone,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Ban,
  Trash2,
  Link2,
  KeyRound,
  MessageSquare,
  ShieldCheck,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { toast } from "@/components/ui/toast"
import {
  listWhatsappNumbers,
  startWhatsappLink,
  confirmWhatsappLink,
  setWhatsappRole,
  revokeWhatsappNumber,
  deleteWhatsappNumber,
  getEffectiveSender,
  type WhatsappNumber,
  type WhatsappRole,
} from "@/lib/adminApi"

const containerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0 },
}

const ROLE_LABEL: Record<WhatsappRole, string> = {
  otp: "OTP sender",
  chat: "User chat",
}

const ROLE_BADGE: Record<WhatsappRole, string> = {
  otp: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  chat: "bg-blue-500/15 text-blue-600 border-blue-500/30",
}

const STATUS_BADGE: Record<WhatsappNumber["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground border-border" },
  linked: { label: "Linked", cls: "bg-ok/15 text-ok border-ok/30" },
  revoked: { label: "Revoked", cls: "bg-destructive/10 text-destructive border-destructive/30" },
}

/** One big copyable pairing code with the phone-side instructions. */
function PairingCodePanel({ code, onDone }: { code: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: "Copy failed", description: "Select the code and copy it manually.", variant: "destructive" })
    }
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          Pairing code
        </CardTitle>
        <CardDescription>
          Enter this code on the phone to link the number. The code expires in about a minute — if it
          expires, press "Re-mint code".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-center gap-3">
          <span
            className="rounded-lg border border-border bg-muted px-6 py-4 font-mono text-3xl font-bold tracking-widest select-all"
            aria-label="Pairing code"
          >
            {code}
          </span>
          <Button variant="outline" onClick={copy} aria-label="Copy pairing code">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <ol className="mx-auto max-w-md list-decimal space-y-1 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <li>Open WhatsApp on the phone that owns this number</li>
          <li>Settings → Linked devices → Link a device</li>
          <li>Tap "Link with phone number instead"</li>
          <li>Type the code shown above</li>
        </ol>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Role dropdown (OTP sender / user chat) as simple buttons. */
function RolePicker({
  role,
  onSet,
  busy,
}: {
  role: WhatsappRole
  onSet: (role: WhatsappRole) => void
  busy: boolean
}) {
  return (
    <div className="flex items-center gap-1" aria-label="Number role">
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet("otp")}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
          role === "otp" ? ROLE_BADGE.otp : "border-border text-muted-foreground hover:bg-muted"
        }`}
        title="This number sends the OTP verification codes"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        OTP
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet("chat")}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
          role === "chat" ? ROLE_BADGE.chat : "border-border text-muted-foreground hover:bg-muted"
        }`}
        title="This number handles user chat / questions"
      >
        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        Chat
      </button>
    </div>
  )
}

/** The admin panel's WhatsApp Numbers page. */
export default function WhatsappNumbersPage() {
  const [numbers, setNumbers] = useState<WhatsappNumber[] | null>(null)
  const [sender, setSender] = useState<{ sender: string | null; source: string } | null>(null)
  const [newPhone, setNewPhone] = useState("")
  const [newRole, setNewRole] = useState<WhatsappRole>("chat")
  const [pairing, setPairing] = useState<{ code: string; number: string } | null>(null)
  const [busyNumber, setBusyNumber] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, eff] = await Promise.all([listWhatsappNumbers(), getEffectiveSender()])
      setNumbers(list)
      setSender(eff)
    } catch (error) {
      toast({
        title: "Could not load numbers",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refresh])

  // While a pairing is shown, poll the link status every few seconds so the
  // UI flips to Linked as soon as Boss enters the code on the phone.
  useEffect(() => {
    if (!pairing) return
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const { status } = await confirmWhatsappLink(pairing.number)
        if (status === "linked") {
          toast({ title: "Number linked", description: `${pairing.number} is now linked.`, variant: "success" })
          setPairing(null)
          void refresh()
        }
      } catch {
        // Polling errors are non-fatal; next tick retries.
      }
    }, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [pairing, refresh])

  const start = async () => {
    const phone = newPhone.replace(/[^0-9]/g, "")
    if (phone.length < 8) {
      toast({ title: "Invalid number", description: "Enter the number with country code, e.g. 2205111924.", variant: "destructive" })
      return
    }
    setStarting(true)
    try {
      const result = await startWhatsappLink(phone, newRole)
      setPairing({ code: result.pairingCode, number: result.number })
      setNewPhone("")
      void refresh()
    } catch (error) {
      toast({
        title: "Could not start linking",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setStarting(false)
    }
  }

  const setRole = async (number: string, role: WhatsappRole) => {
    setBusyNumber(number)
    try {
      await setWhatsappRole(number, role)
      toast({ title: "Role saved", description: `${number} is now ${ROLE_LABEL[role]}.`, variant: "success" })
      void refresh()
    } catch (error) {
      toast({
        title: "Could not set role",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setBusyNumber(null)
    }
  }

  const revoke = async (number: string) => {
    if (!window.confirm(`Revoke ${number}? It will be logged out on the GOWA side and can no longer send messages.`)) return
    setBusyNumber(number)
    try {
      await revokeWhatsappNumber(number)
      toast({ title: "Number revoked", description: `${number} can no longer send.`, variant: "success" })
      void refresh()
    } catch (error) {
      toast({
        title: "Revoke failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setBusyNumber(null)
    }
  }

  const remove = async (number: string) => {
    if (!window.confirm(`Remove ${number} from the panel? The GOWA device slot is deleted too.`)) return
    setBusyNumber(number)
    try {
      await deleteWhatsappNumber(number)
      toast({ title: "Number removed", description: `${number} was deleted.` })
      void refresh()
    } catch (error) {
      toast({
        title: "Remove failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setBusyNumber(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp Numbers"
        description="Numbers this deployment sends from. One number sends the OTP verification codes, another handles user chat."
        actions={
          <Button variant="ghost" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {pairing ? (
        <motion.div variants={itemVariants} initial="hidden" animate="shown" className="mb-6">
          <PairingCodePanel code={pairing.code} onDone={() => setPairing(null)} />
        </motion.div>
      ) : null}

      <motion.div variants={containerVariants} initial="hidden" animate="shown" className="space-y-6">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                Add a number
              </CardTitle>
              <CardDescription>
                Enter the phone number with country code. You'll get a pairing code to enter on the
                phone (no QR scanning needed).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Label htmlFor="new-wa-number">Phone number</Label>
                  <Input
                    id="new-wa-number"
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                    placeholder="2205111924"
                    inputMode="tel"
                    autoComplete="off"
                    className="mt-1 font-mono"
                  />
                </div>
                <RolePicker role={newRole} onSet={setNewRole} busy={starting} />
                <Button onClick={start} disabled={starting || newPhone.trim().length === 0}>
                  <Link2 className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                  {starting ? "Minting code..." : "Get pairing code"}
                </Button>
              </div>
              {sender ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Effective OTP sender:{" "}
                  <span className="font-mono">{sender.sender ?? "not configured"}</span>
                  {sender.source === "registry" ? " (from the numbers below)" : " (app settings fallback)"}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                Numbers
              </CardTitle>
              <CardDescription>
                {numbers?.length ?? "…"} registered. "Pending" means the pairing code was issued but
                the phone hasn't linked yet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!numbers ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : numbers.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No numbers yet. Add one above to get a pairing code.
                </p>
              ) : (
                <div className="space-y-3">
                  {numbers.map((number) => {
                    const status = STATUS_BADGE[number.status]
                    const busy = busyNumber === number.number
                    return (
                      <div
                        key={number.gowaInstance ?? number.number}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-semibold">{number.number || "(unlinked slot)"}</p>
                          <p className="text-xs text-muted-foreground">
                            GOWA: {number.gowaInstance ?? "—"}
                            {number.gowaState ? ` · state: ${number.gowaState}` : ""}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${ROLE_BADGE[number.role]}`}>
                          {number.role === "otp" ? (
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {ROLE_LABEL[number.role]}
                        </span>
                        <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${status.cls}`}>
                          {status.label}
                        </span>
                        <RolePicker role={number.role} onSet={(role) => void setRole(number.number, role)} busy={busy} />
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void revoke(number.number)}>
                          <Ban className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                          Revoke
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(number.number)}>
                          <Trash2 className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                          Remove
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  )
}
