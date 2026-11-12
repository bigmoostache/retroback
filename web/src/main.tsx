import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { App } from "./App.tsx"

const root = document.getElementById("root")
if (!root) throw new Error("index.html has no #root element.")

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable app (PWA). Not in dev: the worker would get in the way of hot reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"))
}
