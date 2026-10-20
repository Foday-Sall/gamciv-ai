import { StrictMode, Suspense, lazy, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes, useOutletContext } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AdminLayout } from "@/layouts/AdminLayout"
import type { DashRole } from "@/lib/authGate"
import "leaflet/dist/leaflet.css"
import "@/index.css"

const InstitutionDashboard = lazy(() => import("@/pages/InstitutionDashboard"))
const OverviewPage = lazy(() => import("@/pages/OverviewPage"))
const InstitutionsPage = lazy(() => import("@/pages/InstitutionsPage"))
const AccountsPage = lazy(() => import("@/pages/AccountsPage"))
const AccessControlPage = lazy(() => import("@/pages/AccessControlPage"))
const AuditLogPage = lazy(() => import("@/pages/AuditLogPage"))
const SettingsPage = lazy(() => import("@/pages/SettingsPage"))
const WhatsappNumbersPage = lazy(() => import("@/pages/WhatsappNumbersPage"))
const NotScheduledPage = lazy(() => import("@/pages/NotScheduledPage").then((module) => ({ default: module.NotScheduledPage })))

function PageLoading() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center text-muted-foreground" role="status" aria-busy="true">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading dashboard page</span>
    </main>
  )
}

function SharedLoginRedirect() {
  useEffect(() => {
    window.location.replace("/app/login")
  }, [])
  return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" role="status">Opening GamCiv sign in…</main>
}

function DashboardHome() {
  const { role } = useOutletContext<{ role: DashRole }>()
  return role === "officer" ? <InstitutionDashboard /> : <OverviewPage />
}

function ProtectedDashboard() {
  return <AdminLayout />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/dash">
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<SharedLoginRedirect />} />
          <Route element={<ProtectedDashboard />}>
            <Route index element={<DashboardHome />} />
            <Route path="institute" element={<Navigate to="/" replace />} />
            <Route path="institutions" element={<InstitutionsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="access-control" element={<AccessControlPage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="whatsapp-numbers" element={<WhatsappNumbersPage />} />
            <Route path="*" element={<NotScheduledPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
