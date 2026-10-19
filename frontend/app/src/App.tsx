import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import AppShell from '@/components/AppShell'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import Home from '@/pages/Home'
import Auth from '@/pages/Auth'
import Report from '@/pages/Report'
import Track from '@/pages/Track'
import Profile from '@/pages/Profile'
import MyReports from '@/pages/MyReports'

/** Toaster position: bottom-right on desktop, top-center on mobile (spec §6). */
function PositionedToaster() {
  const isDesktop = useIsDesktop()
  return <Toaster position={isDesktop ? 'bottom-right' : 'top-center'} />
}

export default function App() {
  return (
    <>
      <PositionedToaster />
      <Routes>
        {/* Auth pages bypass the shell */}
        <Route path="/login" element={<Auth key="signin" initialMode="signin" />} />
        <Route path="/signup" element={<Auth key="signup" initialMode="signup" />} />

        {/* Shell layout: top bar + bottom tabs (mobile) + desktop nav */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
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
