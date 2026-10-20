/**
 * AppShell — the single navigation shell for every signed-in (and public
 * lookup) page. Per the redesign spec §2:
 *  - TopBar always: brand; desktop ≥1024px also shows nav links + bell + avatar.
 *  - BottomTabBar below 1024px: Home | Report | My Reports | Track | Profile,
 *    Report as the raised green center button. Hidden in wizard focus mode
 *    (/report before success) and on /login /signup (which bypass the shell).
 *  - Report focus mode: top bar shows brand + "New report" + Close (guarded),
 *    no nav links, no tab bar.
 */
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MotionConfig } from 'framer-motion'
import {
  Bell,
  CircleUserRound,
  FileText,
  Home as HomeIcon,
  LogOut,
  MapPin,
  PlusCircle,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutDialog } from '@/components/ConfirmDialogs'
import PageTransition from '@/components/PageTransition'
import { useSession, useDisplayName } from '@/hooks/useSession'
import { supabase, getProfile, STAFF_DASHBOARD_URL, OFFICER_DASHBOARD_URL } from '@/lib/supabase'
import GamCivMark from '@/components/GamCivMark'
import { toast } from 'sonner'

const NAV_LINKS = [
  { to: '/home', label: 'Home' },
  { to: '/report', label: 'Report a problem' },
  { to: '/my-reports', label: 'My reports' },
  { to: '/track', label: 'Track' },
]

const TABS = [
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/report', label: 'Report', Icon: PlusCircle, center: true },
  { to: '/my-reports', label: 'My Reports', Icon: FileText },
  { to: '/track', label: 'Track', Icon: MapPin },
  { to: '/profile', label: 'Profile', Icon: CircleUserRound },
]

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const second = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + second).toUpperCase() || '?'
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { session } = useSession()
  const name = useDisplayName(session)
  const [scrolled, setScrolled] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const isFocusMode = location.pathname === '/report'
  const email = session?.user?.email ?? null

  // A signed-in staff member (officer/admin) browsing the citizen app should
  // be sent to the dashboard: officers to their institution's dashboard,
  // admins to the console. Runs once per session; no redirect while the
  // profile lookup fails (do not bounce people over a transient error).
  useEffect(() => {
    if (!session?.user?.id) return
    let cancelled = false
    getProfile(session.user.id).then((p) => {
      if (cancelled) return
      if (p?.role === 'officer') {
        window.location.href = OFFICER_DASHBOARD_URL
      } else if (p?.role === 'admin') {
        window.location.href = STAFF_DASHBOARD_URL
      }
    })
    return () => {
      cancelled = true
    }
  }, [session?.user?.id])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  async function signOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    setSigningOut(false)
    setSignOutOpen(false)
    if (error) {
      toast.error('Could not sign out. Try again.')
      return
    }
    toast.success('Signed out')
    navigate('/login', { replace: true })
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-background">
      {/* ── TopBar ─────────────────────────────────────────────── */}
      <header
        data-scrolled={scrolled ? 'true' : 'false'}
        className="sticky top-0 z-50 border-b border-clay-line bg-background/95 backdrop-blur data-[scrolled=true]:shadow-sm"
      >
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5 md:px-6">
          {isFocusMode ? (
            <>
              <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight font-display">
                <GamCivMark />
                New report
              </div>
              <button
                type="button"
                aria-label="Close and exit report"
                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => window.dispatchEvent(new Event('gamciv:exit-report'))}
              >
                <X className="h-5 w-5" />
              </button>
            </>
          ) : (
            <>
              <Link
                to="/home"
                className="flex items-center gap-2.5 text-lg font-bold tracking-tight font-display"
              >
                <GamCivMark />
                <span className={isFocusMode ? '' : ''}>GamCiv</span>
              </Link>

              {/* Desktop nav links */}
              <nav
                aria-label="Primary"
                className="hidden items-center gap-6 min-[1024px]:flex"
              >
                {NAV_LINKS.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    className={({ isActive }) =>
                      'relative text-sm font-medium transition-colors after:absolute after:inset-x-0 after:bottom-[-6px] after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-150 hover:text-foreground ' +
                      (isActive
                        ? 'font-semibold text-primary after:scale-x-100'
                        : 'text-muted-foreground')
                    }
                  >
                    {l.label}
                  </NavLink>
                ))}
              </nav>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden min-[1024px]:inline-flex"
                  aria-label="Notifications"
                  title="No new updates yet"
                >
                  <Bell />
                </Button>
                {session && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-11 items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Account menu"
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-secondary text-sm font-semibold text-foreground">
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuLabel className="truncate">
                        <p className="font-semibold">{name}</p>
                        {email && (
                          <p className="truncate text-xs font-normal text-muted-foreground">
                            {email}
                          </p>
                        )}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/profile">Profile</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/my-reports">My reports</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setSignOutOpen(true)}
                      >
                        <LogOut />
                        Sign out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────── */}
      <main className={isFocusMode ? 'flex-1' : 'flex-1 pb-24 min-[1024px]:pb-12'}>
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition routeKey={location.pathname}>
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </main>

      {/* ── Footer (not in focus mode; wizard has its own) ─────── */}
      {!isFocusMode && (
        <footer className="hairline-t pb-20 min-[1024px]:pb-0">
          <div className="mx-auto max-w-[1200px] px-5 py-6 text-sm text-muted-foreground md:px-6">
            GamCiv — report public problems in The Gambia.
          </div>
        </footer>
      )}

      {/* ── Bottom tab bar (<1024px, not focus mode) ───────────── */}
      {!isFocusMode && (
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-clay-line bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 min-[1024px]:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto flex h-16 max-w-[480px] items-stretch justify-around px-1">
            {TABS.map(({ to, label, Icon, center }) => {
              const active = location.pathname === to
              return center ? (
                <motion.div
                  key={to}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.1 }}
                  className="min-w-12"
                >
                  <Link
                    to={to}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className="flex flex-col items-center justify-center gap-0.5 px-2 pt-1"
                  >
                    <motion.span
                      animate={
                        active
                          ? { y: -8, scale: 1.06 }
                          : { y: -8, scale: 1 }
                      }
                      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                      className={
                        'flex h-11 w-11 items-center justify-center rounded-full transition-colors ' +
                        (active
                          ? 'bg-primary/90 text-primary-foreground shadow-md'
                          : 'bg-primary text-primary-foreground shadow-sm')
                      }
                    >
                      <Icon className="h-6 w-6" />
                    </motion.span>
                    <span className="-mt-1.5 text-[11px] font-semibold text-primary">
                      {label}
                    </span>
                  </Link>
                </motion.div>
              ) : (
                <motion.div
                  key={to}
                  whileTap={{ scale: 0.92 }}
                  transition={{ duration: 0.1 }}
                  className="min-w-12"
                >
                  <Link
                    to={to}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className="flex flex-col items-center justify-center gap-0.5 px-1 py-2"
                  >
                    {/* Sliding pill behind the active icon */}
                    <span className="relative flex h-9 w-9 items-center justify-center">
                      <AnimatePresence>
                        {active && (
                          <motion.span
                            layoutId="tab-pill"
                            className="absolute inset-0 rounded-full bg-primary/10"
                            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          />
                        )}
                      </AnimatePresence>
                      <motion.span
                        animate={active ? { scale: 1.08 } : { scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                        className={
                          'relative ' + (active ? 'text-primary' : 'text-muted-foreground')
                        }
                      >
                        <Icon className="h-6 w-6" />
                      </motion.span>
                    </span>
                    <span
                      className={
                        'text-[11px] ' +
                        (active
                          ? 'font-bold text-primary'
                          : 'font-semibold text-muted-foreground')
                      }
                    >
                      {label}
                    </span>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </nav>
      )}

      <SignOutDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onConfirm={signOut}
        busy={signingOut}
      />
      </div>
    </MotionConfig>
  )
}
