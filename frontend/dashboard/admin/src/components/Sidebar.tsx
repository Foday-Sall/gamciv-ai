import { NavLink } from "react-router-dom"
import { motion } from "framer-motion"
import {
  LayoutDashboard,
  Building2,
  Users,
  Shield,
  ScrollText,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type NavKey =
  | "overview"
  | "institutions"
  | "accounts"
  | "access-control"
  | "audit-log"
  | "settings"

export type NavItem = {
  key: NavKey
  to: string
  label: string
  subtext: string
  Icon: typeof LayoutDashboard
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", to: "/", label: "Overview", subtext: "Complaint volume at a glance", Icon: LayoutDashboard },
  { key: "institutions", to: "/institutions", label: "Institutions", subtext: "Agencies on the platform", Icon: Building2 },
  { key: "accounts", to: "/accounts", label: "Accounts", subtext: "Accounts you issued", Icon: Users },
  { key: "access-control", to: "/access-control", label: "Access Control", subtext: "Limits per institution", Icon: Shield },
  { key: "audit-log", to: "/audit-log", label: "Audit Log", subtext: "Every administrative action", Icon: ScrollText },
  { key: "settings", to: "/settings", label: "Settings", subtext: "Escalation and notifications", Icon: Settings },
]

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean
  onToggle: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}) {
  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      ) : null}

      <motion.aside
        animate={{ width: collapsed ? 76 : 264 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-card",
          "transition-transform duration-200 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
            A
          </div>
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold">GamCiv Admin</p>
              <p className="truncate text-xs text-muted-foreground">Administrator console</p>
            </div>
          )}
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3 slim-scroll" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === "/"}
              onClick={onMobileClose}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
              title={collapsed ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  <item.Icon
                    className="h-4.5 w-4.5 shrink-0"
                    style={{ strokeWidth: 1.75 }}
                    aria-hidden="true"
                  />
                  {collapsed ? null : (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {item.subtext}
                      </span>
                    </span>
                  )}
                  {isActive && !collapsed ? (
                    <motion.span
                      layoutId="nav-active-dot"
                      className="h-1.5 w-1.5 rounded-full bg-primary"
                    />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-border p-3 md:block">
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <>
                <ChevronsRight className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                <span className="sr-only">Expand sidebar</span>
              </>
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                Collapse
              </>
            )}
          </button>
        </div>
      </motion.aside>
    </>
  )
}
