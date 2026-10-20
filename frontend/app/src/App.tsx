import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import AppShell from '@/components/AppShell'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import HomeGate from '@/pages/HomeGate'
import Auth from '@/pages/Auth'
import ForgotPassword from '@/pages/ForgotPassword'
import ResetPassword from '@/pages/ResetPassword'
import Report from '@/pages/Report'
import Track from '@/pages/Track'
import Profile from '@/pages/Profile'
import MyReports from '@/pages/MyReports'
import VerifyEmail from '@/pages/VerifyEmail'
import VerifyPhone from '@/pages/VerifyPhone'

/** Toaster position: bottom-right on desktop, top-center on mobile (spec §6). */
function PositionedToaster() {
  const isDesktop = useIsDesktop()
  return <Toaster position={isDesktop ? 'bottom-right' : 'top-center'} />
}

function LegacyInstitutionRedirect() {
  useEffect(() => {
    window.location.replace('/dash')
  }, [])
  return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" role="status">Opening your dashboard…</main>
}

export default function App() {
  return (
    <>
      <PositionedToaster />
      <Routes>
        {/* Password recovery uses a separate email request and recovery OTP flow. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Verification screens: OTP entry, reachable with or without a session */}
        <Route path="/verify/email" element={<VerifyEmail />} />
        <Route path="/verify/phone" element={<VerifyPhone />} />

        {/* Auth pages bypass the shell */}
        <Route path="/login" element={<Auth key="signin" initialMode="signin" />} />
        <Route path="/signup" element={<Auth key="signup" initialMode="signup" />} />

        {/* Shell layout: top bar + bottom tabs (mobile) + desktop nav */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomeGate />} />
          <Route path="/institute" element={<LegacyInstitutionRedirect />} />
          <Route path="/report" element={<Report />} />
          <Route path="/track" element={<Track />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/my-reports" element={<MyReports />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </>
  )
}
