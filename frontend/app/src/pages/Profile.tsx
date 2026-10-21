/**
 * /profile — the signed-in user's account page. Per spec §3d:
 * mobile: centered max-w-md card stack; desktop: 7/5 two-column grid.
 * Navigation lives in AppShell. Sign out uses SignOutDialog (destructive).
 *
 * Profile editing: the owner can change their display name and upload an
 * avatar. Edits go straight to public.profiles (RLS limits self-updates to
 * the owner's row; trg_profile_column_guard blocks changing role/email/phone).
 * Avatars live in the public 'avatars' storage bucket under avatars/<uid>/ —
 * public read, owner-folder-only write.
 */
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LogOut, Mail, ShieldCheck, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useSession, useDisplayName } from '@/hooks/useSession'
import { supabase } from '@/lib/supabase'
import { SignOutDialog } from '@/components/ConfirmDialogs'

export const APP_VERSION = '1.1.0'

/** Max avatar size: must match storage.buckets.file_size_limit (5 MB). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function Profile() {
  const { session, loading } = useSession()
  const name = useDisplayName(session)
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // --- profile editing state ---
  const [fullName, setFullName] = useState('')
  const [savedName, setSavedName] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // --- avatar state ---
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    document.title = 'Your profile · GamFix'
  }, [])

  // Load the profile row once the session is known.
  useEffect(() => {
    let cancelled = false
    const uid = session?.user.id
    if (!uid) return
    supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('user_id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        setFullName(data.full_name ?? '')
        setSavedName(data.full_name)
        setAvatarUrl(data.avatar_url)
      })
    return () => {
      cancelled = true
    }
  }, [session?.user.id])

  async function signOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    setSigningOut(false)
    setConfirmOpen(false)
    if (error) {
      toast.error('Could not sign out. Try again.')
      return
    }
    toast.success('Signed out')
    navigate('/login', { replace: true })
  }

  async function saveName() {
    if (!session?.user) return
    const uid = session.user.id
    const trimmed = fullName.trim()
    if (!trimmed) {
      setMsg({ kind: 'err', text: "Name can't be empty." })
      return
    }
    setSavingName(true)
    setMsg(null)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: trimmed })
      .eq('user_id', uid)
    setSavingName(false)
    if (error) {
      setMsg({ kind: 'err', text: 'Could not save your name. Try again.' })
      return
    }
    setSavedName(trimmed)
    // Refresh auth metadata so other pages show the new name right away.
    await supabase.auth.updateUser({ data: { full_name: trimmed } })
    setMsg({ kind: 'ok', text: 'Name updated.' })
  }

  async function onPickAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so picking the same file again still fires change.
    event.target.value = ''
    if (!file || !session?.user) return
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setMsg({ kind: 'err', text: 'Please choose a JPEG, PNG or WebP image.' })
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setMsg({ kind: 'err', text: 'Image is too large — max 5 MB.' })
      return
    }
    setUploading(true)
    setMsg(null)
    try {
      const uid = session.user.id
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${uid}/${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, file, { cacheControl: '3600', upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      // Save URL to the profile row (owner-only, guarded by RLS).
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ avatar_url: data.publicUrl })
        .eq('user_id', uid)
      if (dbErr) throw dbErr
      setAvatarUrl(data.publicUrl)
      setMsg({ kind: 'ok', text: 'Photo updated.' })
    } catch {
      setMsg({ kind: 'err', text: 'Could not upload the photo. Try again.' })
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading…
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  const user = session.user
  const meta = user.user_metadata ?? {}
  const displayName =
    savedName ||
    name ||
    (meta.full_name as string) ||
    (meta.name as string) ||
    user.email ||
    'Your account'
  const email = user.email
  const createdAt = user.created_at ? new Date(user.created_at) : null

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-6">
      <div className="mx-auto w-full max-w-md min-[1024px]:mx-0 min-[1024px]:max-w-none">
        <h1 className="font-display text-2xl font-bold tracking-tight">Your profile</h1>
        <p className="mt-2 text-muted-foreground">Your account details for reporting.</p>

        <div className="mt-6 grid grid-cols-1 gap-4 min-[1024px]:grid-cols-12">
          {/* Account card (col 7 on desktop) */}
          <div className="rounded-xl border border-border bg-card p-5 min-[1024px]:col-span-7">
            {/* Avatar block: current photo or initials fallback */}
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Your profile picture"
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
                  <User className="h-7 w-7 text-primary" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold leading-tight">
                  {displayName}
                </p>
                {email && displayName !== email && (
                  <p className="truncate text-sm text-muted-foreground">{email}</p>
                )}
              </div>
              <div className="ml-auto shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? 'Uploading…' : 'Change photo'}
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onPickAvatar}
            />

            {/* Name editor */}
            <div className="mt-5 border-t border-border/60 pt-4">
              <label className="text-sm font-medium" htmlFor="profile-name">
                Display name
              </label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="profile-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  maxLength={80}
                  className="h-11"
                  autoComplete="name"
                />
                <Button
                  onClick={saveName}
                  disabled={savingName || !fullName.trim() || fullName.trim() === savedName}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </Button>
              </div>
              {msg && (
                <p
                  className={
                    msg.kind === 'ok'
                      ? 'mt-2 text-sm text-emerald-600'
                      : 'mt-2 text-sm text-red-600'
                  }
                  role="status"
                >
                  {msg.text}
                </p>
              )}
            </div>

            <div className="mt-5 space-y-3 border-t border-border/60 pt-4 text-sm">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">Email</span>
                <span className="ml-auto truncate font-medium" title={email ?? undefined}>
                  {email ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">Member since</span>
                <span className="ml-auto font-medium">
                  {createdAt
                    ? createdAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Session + version (col 5 on desktop) */}
          <div className="space-y-4 min-[1024px]:col-span-5">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm font-medium">Session</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Signing out keeps your submitted reports — you can still follow them with
                their tracking numbers.
              </p>
              <Button
                variant="outline"
                className="mt-4 h-11 w-full"
                onClick={() => setConfirmOpen(true)}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                GamFix web app · version {APP_VERSION}
              </p>
              <Badge variant="outline" className="border-border text-muted-foreground">
                Beta
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <SignOutDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={signOut}
        busy={signingOut}
      />
    </div>
  )
}
