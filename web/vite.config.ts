import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// The web app talks to the engine API (engine/src/server.ts) through /api, and signs in through /auth.
const engine = { target: "http://127.0.0.1:7979", changeOrigin: true }
const api = { "/api": engine, "/auth": engine, "/entrypoint.md": engine }

// Bound to 127.0.0.1 like the API. With the default host, `localhost` resolved to
// ::1 only and strictPort did not see another server holding the port on IPv4.
const listen = { host: "127.0.0.1", port: 5190, strictPort: true, proxy: api }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: listen,
  preview: listen,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Shared with the engine: result shapes (types.ts) and the CLI spelling (flags.ts).
      "@engine": path.resolve(import.meta.dirname, "../engine/src"),
    },
  },
})
