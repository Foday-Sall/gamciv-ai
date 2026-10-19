import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { AdminLayout } from "@/layouts/AdminLayout"
import OverviewPage from "@/pages/OverviewPage"
import InstitutionsPage from "@/pages/InstitutionsPage"
import AccountsPage from "@/pages/AccountsPage"
import AccessControlPage from "@/pages/AccessControlPage"
import AuditLogPage from "@/pages/AuditLogPage"
import SettingsPage from "@/pages/SettingsPage"
import { NotScheduledPage } from "@/pages/NotScheduledPage"
import "@/index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="/institutions" element={<InstitutionsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/access-control" element={<AccessControlPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotScheduledPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
