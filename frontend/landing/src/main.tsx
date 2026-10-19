import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import Legal from "./Legal"
import "./index.css"

const path = window.location.pathname

// The React app is served under /app/. Root-level app URLs (e.g. /track,
// shared or bookmarked before the move) must not fall through to the
// marketing page: forward them to the app so refreshes and shared links
// keep working. The landing only owns "/", /privacy and /terms — every
// other root path belongs to the app (which routes unknown paths to /home).
const isLandingPath = path === "/" || path === "/privacy" || path === "/terms"
const isAppBase = path === "/app" || path.startsWith("/app/")
if (!isLandingPath && !isAppBase) {
  window.location.replace(`/app${path}${window.location.search}${window.location.hash}`)
} else if (path === "/privacy" || path === "/terms") {
  const title = path === "/privacy" ? "Privacy Policy" : "Terms of Service"
  document.title = `${title} - GamCiv`
  const root = createRoot(document.getElementById("root")!)
  root.render(
    <StrictMode>
      <Legal page={path === "/privacy" ? "privacy" : "terms"} />
    </StrictMode>
  )
} else {
  const root = createRoot(document.getElementById("root")!)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
