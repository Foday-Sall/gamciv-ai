import { useEffect, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { Toaster } from "@/components/ui/toast"
import { Sidebar } from "@/components/Sidebar"
import { Topbar } from "@/components/Topbar"
import { cn } from "@/lib/utils"
import { resolveSessionRole } from "@/lib/authGate"
import { Loader2 } from "lucide-react"

/**
 * Route guard for the administrator console.
 *
 *   role = admin   -> console (Outlet)
 *   role = officer -> the institution dashboard at officerPath
 *   no session     -> the dashboard login at loginPath
 *
 * Server-side every admin RPC re-checks fn_is_admin(), and the officer's
 * data read is RLS-scoped by comp_select_officer_own_inst, so this gate only
 * prevents non-admins from staring at a wall of failing requests — it is not
 * the security control itself.
 */
export function AdminLayout({
  officerPath = "/institute",
  loginPath = "/login",
}: {
  officerPath?: string
  loginPath?: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [checked, setChecked] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function gate() {
      const info = await resolveSessionRole()
      if (cancelled) return
      if (!info.session) {
        // Not signed in: the login screen is all they get.
        window.location.href = loginPath
        return
      }
      if (info.role === "officer") {
        window.location.href = officerPath
        return
      }
      if (info.role !== "admin") {
        // Signed in but not staff (citizen or unknown): citizen app.
        window.location.href = "/app/login"
        return
      }
      setChecked(true)
    }

    gate()
    return () => {
      cancelled = true
    }
  }, [navigate, officerPath, loginPath])

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((previous) => !previous)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300",
          collapsed ? "md:pl-[76px]" : "md:pl-[264px]"
        )}
      >
        <Topbar onMenu={() => setMobileOpen(true)} search={search} onSearchChange={setSearch} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
