import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import Legal from "./Legal"
import "./index.css"

const path = window.location.pathname

const root = createRoot(document.getElementById("root")!)
if (path === "/privacy" || path === "/terms") {
  const title = path === "/privacy" ? "Privacy Policy" : "Terms of Service"
  document.title = `${title} - GamCiv`
  root.render(
    <StrictMode>
      <Legal page={path === "/privacy" ? "privacy" : "terms"} />
    </StrictMode>
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
