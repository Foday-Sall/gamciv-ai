import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Loader2, RefreshCw } from "lucide-react"
import { Toaster } from "@/components/ui/toast"
import { Sidebar } from "@/components/Sidebar"
import { Topbar } from "@/components/Topbar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resolveSessionRole, type DashRole } from "@/lib/authGate"

type GateState =
  | { status: "checking" }
  | { status: "error" }
  | { status: "ready"; role: DashRole }

/** Shared protected route: an institution staff member or the sole admin. */
export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [retry, setRetry] = useState(0)
  const [gate, setGate] = useState<GateState>({ status: "checking" })
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    setGate({ status: "checking" })
    void resolveSessionRole().then((info) => {
      if (cancelled) return
      if (!info.session) {
        window.location.replace("/app/login")
        return
      }
      if (info.error) {
        setGate({ status: "error" })
        return
      }
      if (!info.role) {
        window.location.replace("/app/home")
        return
      }
      setGate({ status: "ready", role: info.role })
    }).catch(() => {
      if (!cancelled) setGate({ status: "error" })
    })
    return () => {
      cancelled = true
    }
  }, [retry])

  if (gate.status === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Verifying dashboard access</span>
      </main>
    )
  }

  if (gate.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
        <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="font-display text-xl font-semibold">Dashboard access unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">We couldn’t verify your session with GamCiv. Check your connection and try again.</p>
          <Button className="mt-5" onClick={() => setRetry((value) => value + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Try again
          </Button>
        </section>
      </main>
    )
  }

  // Institution staff always land on the same /dash path; every other console
  // route is admin-only and redirects them back to their institution workspace.
  if (gate.role === "officer" && location.pathname !== "/") {
    return <Navigate to="/" replace />
  }
  if (gate.role === "admin" && location.pathname === "/institute") {
    return <Navigate to="/" replace />
  }

  if (gate.role === "officer") {
    return <Outlet context={{ role: gate.role }} />
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((previous) => !previous)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className={cn(
        "flex min-h-screen flex-col transition-[padding] duration-300",
        collapsed ? "md:pl-[76px]" : "md:pl-[264px]",
      )}>
        <Topbar onMenu={() => setMobileOpen(true)} search={search} onSearchChange={setSearch} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-6">
          <Outlet context={{ role: gate.role }} />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
