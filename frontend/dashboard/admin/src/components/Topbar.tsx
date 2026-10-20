import { Search, Menu, Bell, Loader2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { supabase } from "@/lib/secretsClient"
import { useState } from "react"

export function Topbar({
  onMenu,
  search,
  onSearchChange,
}: {
  onMenu: () => void
  search: string
  onSearchChange: (value: string) => void
}) {
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
    } finally {
      // Session is gone (or the call failed) — leave the console regardless.
      window.location.href = "/login"
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
      </Button>

      <div className="relative max-w-md flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          style={{ strokeWidth: 1.75 }}
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search institutions, accounts, actions"
          aria-label="Search the admin console"
          className="h-10 w-full rounded-lg border border-border bg-input/40 pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/60"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted"
              aria-label="Administrator menu"
            >
              <Avatar>
                <AvatarFallback className="bg-primary/15 text-primary">FS</AvatarFallback>
              </Avatar>
              <span className="hidden text-left lg:block">
                <span className="block text-sm font-medium leading-tight">Foday</span>
                <span className="block text-xs text-muted-foreground leading-tight">Administrator</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Administrator</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <Badge variant="success">Single administrator session</Badge>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                if (!signingOut) void signOut()
              }}
            >
              {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
