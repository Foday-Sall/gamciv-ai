import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Toaster } from "@/components/ui/toast"
import { Sidebar } from "@/components/Sidebar"
import { Topbar } from "@/components/Topbar"
import { cn } from "@/lib/utils"

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState("")

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
