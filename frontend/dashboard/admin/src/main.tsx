import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AdminLayout } from "@/layouts/AdminLayout"
import LoginPage from "@/pages/LoginPage"
import InstitutionDashboard from "@/pages/InstitutionDashboard"
import OverviewPage from "@/pages/OverviewPage"
import InstitutionsPage from "@/pages/InstitutionsPage"
import AccountsPage from "@/pages/AccountsPage"
import AccessControlPage from "@/pages/AccessControlPage"
import AuditLogPage from "@/pages/AuditLogPage"
import SettingsPage from "@/pages/SettingsPage"
import WhatsappNumbersPage from "@/pages/WhatsappNumbersPage"
import { NotScheduledPage } from "@/pages/NotScheduledPage"
import "@/index.css"

/**
 * Dashboard routes.
 *
 *   /login      -> the dashboard's own login screen (OTP code + password
 *                  fallback). Unauthenticated visitors land here and see
 *                  nothing else: every data view is behind the gate.
 *   /institute  -> role=officer view (own-institution complaints, RLS-scoped
 *                  by comp_select_officer_own_inst).
 *   /           -> role=admin view (the full administrator console, gated in
 *                  AdminLayout).
 *
 * The gate lives in AdminLayout (session + profile role check): admins see
 * the console, officers are routed to /institute, signed-out visitors are
 * routed to /login. Unauthenticated users never see dashboard data because
 * every page is a child of the gated layout (and the REST reads return
 * zero rows for the anon key).
 */
function AdminLayoutGate() {
  return <AdminLayout officerPath="/institute" loginPath="/login" />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/institute" element={<InstitutionDashboard />} />
        <Route element={<AdminLayoutGate />}>
          <Route index element={<OverviewPage />} />
          <Route path="/institutions" element={<InstitutionsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/access-control" element={<AccessControlPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/whatsapp-numbers" element={<WhatsappNumbersPage />} />
          <Route path="*" element={<NotScheduledPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
