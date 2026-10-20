import { useEffect, useState, type ReactNode } from "react"
import {
  Building2,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type OfficerSection = "overview" | "analytics" | "complaints"

const sections: Array<{
  id: OfficerSection
  label: string
  description: string
  Icon: typeof LayoutDashboard
}> = [
  { id: "overview", label: "Overview", description: "Your complaint summary", Icon: LayoutDashboard },
  { id: "analytics", label: "Analytics", description: "Trends and categories", Icon: ChartNoAxesCombined },
  { id: "complaints", label: "Complaints", description: "Recent reports", Icon: ClipboardList },
]

export function OfficerShell({
  institutionName,
  activeSection,
  onNavigate,
  onRefresh,
  onSignOut,
  refreshing,
  children,
}: {
  institutionName: string
  activeSection: OfficerSection
  onNavigate: (section: OfficerSection) => void
  onRefresh: () => void
  onSignOut: () => void
  refreshing: boolean
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [manualActiveSection, setManualActiveSection] = useState<OfficerSection | null>(null)

  useEffect(() => {
    const resumeScrollTracking = () => setManualActiveSection(null)
    window.addEventListener("wheel", resumeScrollTracking, { passive: true })
    window.addEventListener("touchstart", resumeScrollTracking, { passive: true })
    window.addEventListener("keydown", resumeScrollTracking)
    return () => {
      window.removeEventListener("wheel", resumeScrollTracking)
      window.removeEventListener("touchstart", resumeScrollTracking)
      window.removeEventListener("keydown", resumeScrollTracking)
    }
  }, [])

  function navigate(section: OfficerSection) {
    setManualActiveSection(section)
    onNavigate(section)
    setMobileOpen(false)
  }

  function Navigation({ mobile = false }: { mobile?: boolean }) {
    return (
      <nav aria-label="Officer navigation" className="space-y-1 px-3 py-4">
        <p className={cn("px-3 pb-2 text-xs font-medium text-muted-foreground", !mobile && collapsed && "sr-only")}>
          Workspace
        </p>
        {sections.map(({ id, label, description, Icon }) => {
          const active = (manualActiveSection ?? activeSection) === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              aria-label={label}
              aria-current={active ? "location" : undefined}
              title={!mobile && collapsed ? label : undefined}
              className={cn(
                "group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "motion-reduce:transition-none",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                !mobile && collapsed && "justify-center px-2",
              )}
            >
              <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              {mobile || !collapsed ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{description}</span>
                </span>
              ) : null}
              {active && (mobile || !collapsed) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </nav>
    )
  }

  function Brand({ compact = false }: { compact?: boolean }) {
    return (
      <div className={cn("flex min-w-0 items-center gap-3", compact && "px-4")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">GamCiv</p>
          <p className="truncate text-xs text-muted-foreground">{institutionName}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-card md:flex",
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "w-[76px]" : "w-[264px]",
        )}
        aria-label="Officer workspace sidebar"
      >
        <div className={cn("flex h-16 shrink-0 items-center border-b border-border", collapsed ? "justify-center px-3" : "px-5")}>
          {collapsed ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground" title={`GamCiv · ${institutionName}`}>
              <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
          ) : <Brand />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation />
        </div>
        <div className="space-y-1 border-t border-border p-3">
          <Button
            type="button"
            variant="ghost"
            className={cn("w-full justify-start text-muted-foreground", collapsed && "justify-center px-2")}
            onClick={onSignOut}
            title={collapsed ? "Sign out" : undefined}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {!collapsed && <span className="ml-2">Sign out</span>}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={cn("w-full justify-start text-muted-foreground", collapsed && "justify-center px-2")}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            {!collapsed && <span className="ml-2">Collapse sidebar</span>}
          </Button>
        </div>
      </aside>

      <div className={cn("min-h-screen transition-[padding] duration-200 ease-out motion-reduce:transition-none", collapsed ? "md:pl-[76px]" : "md:pl-[264px]")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm md:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1 md:hidden">
            <p className="truncate text-sm font-semibold">GamCiv</p>
            <p className="truncate text-xs text-muted-foreground">{institutionName}</p>
          </div>
          <div className="hidden min-w-0 flex-1 md:block">
            <p className="truncate text-sm font-medium">{institutionName}</p>
            <p className="text-xs text-muted-foreground">Institution workspace</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            <span className="hidden sm:inline">{refreshing ? "Refreshing" : "Refresh data"}</span>
            <span className="sm:hidden sr-only">{refreshing ? "Refreshing data" : "Refresh data"}</span>
          </Button>
          <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={onSignOut} aria-label="Sign out">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        <main id="officer-main" className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
          {children}
        </main>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          side="left"
          className={cn(
            "duration-200",
          )}
          aria-describedby={undefined}
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border pr-3">
            <Brand compact />
            <span className="pr-10" aria-hidden="true" />
          </div>
          <div className="flex-1 overflow-y-auto">
            <Navigation mobile />
          </div>
          <div className="border-t border-border p-3">
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={onSignOut}>
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Sign out
            </Button>
          </div>
          <DialogTitle className="sr-only">Officer navigation</DialogTitle>
        </DialogContent>
      </Dialog>
    </div>
  )
}
