import gamfixLogo from "@/assets/gamfix-logo.png"
import { Button } from "@/components/ui/button"

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
        <a href="/" className="flex items-center" aria-label="GamFix home">
          <img src={gamfixLogo} alt="GamFix" className="h-9 w-auto max-w-[150px] object-contain" draggable={false} />
        </a>
        <div className="flex items-center gap-6">
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex" aria-label="Main">
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#institutions" className="transition-colors hover:text-foreground">Institutions</a>
          </nav>
          <Button asChild className="hidden h-9 px-4 md:inline-flex">
            <a href="#report">Get early access</a>
          </Button>
        </div>
      </div>
    </header>
  )
}
