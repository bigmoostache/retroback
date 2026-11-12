/**
 * Settings, from the environment. A .env file at the repo root is read first
 * when there is one (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DEV...).
 */
import { existsSync } from "node:fs"
import path from "node:path"

const dotenv = path.resolve(import.meta.dirname, "../../.env")
if (existsSync(dotenv)) process.loadEnvFile(dotenv)

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://retroback:retroback@127.0.0.1:55440/retroback"

export const API_PORT = Number(process.env.RETROBACK_API_PORT ?? 7979)

/** DEV=true: no Google, every web request is signed in as DEV_EMAIL. API keys still work. */
export const DEV = process.env.DEV === "true"
export const DEV_EMAIL = "local@dev"

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ""
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ""

/** Where the web app is served: Google sends the user back there. */
export const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://127.0.0.1:5190").replace(/\/+$/, "")
