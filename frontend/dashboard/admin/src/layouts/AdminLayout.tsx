import { useEffect, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { Toaster } from "@/components/ui/toast"
import { Sidebar } from "@/components/Sidebar"
import { Topbar } from "@/components/Topbar"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/secretsClient"
import { Loader2 } from "lucide-react"

/**
 * Route guard: only profiles with role = "admin" may use the console.
 * Server-side every admin RPC re-checks fn_is_admin(), so this gate only
 * prevents non-admins from staring at a wall of failing requests.
 */
export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [checked, setChecked] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function gate() {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (!user) {
        window.location.href = "/app/login"
        return
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single()
      if (cancelled) return
      if (profile?.role !== "admin") {
        // Not an admin: back to the citizen/staff app.
        window.location.href = "/app/home"
        return
      }
      setChecked(true)
    }

    gate()
    return () => {
      cancelled = true
    }
  }, [navigate])

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
