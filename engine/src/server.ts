/**
 * The HTTP API of the engine, built from the registry (ops/index.ts).
 *
 *   GET  /api/ops               every operation with its input (same as `rb op list`), no sign-in needed
 *   GET  /entrypoint.md         how an agent installs and configures rb, no sign-in needed
 *   POST /api/<entity>.<verb>   run an operation as the signed-in user; the JSON body is its input
 *
 * Who is signed in, first match wins:
 *   Authorization: Bearer rb_...   an API key (what `rb` sends)
 *   cookie rb_session              a web login, opened by Google sign-in
 *   DEV=true                       local@dev, with no Google at all
 *
 *   GET  /auth/me                  who the browser is signed in as, and how it can sign in
 *   GET  /auth/google              sign in with Google
 *   GET  /auth/google/callback     where Google sends the user back
 *   POST /auth/logout              close the web session
 *
 * The answer of an operation is always an OpResponse, the same one `rb --json` prints.
 * Status: 200 ok, 400 invalid, 401 unauthorized, 403 forbidden, 404 not_found, 409 conflict, 500 bug.
 */
import { randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { closeSession, openSession, userByEmail, userOfKey, userOfSession } from "./access.ts"
import { db } from "./db.ts"
import { API_PORT, DEV, DEV_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL } from "./env.ts"
import { entrypoint } from "./entrypoint.ts"
import type { User } from "./ops/define.ts"
import { runOp } from "./ops/index.ts"
import type { OpResponse } from "./types.ts"

const HOST = "127.0.0.1"
const MAX_BODY = 1_000_000
const STATUS: Record<string, number> = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409 }
const SESSION_COOKIE = "rb_session"
const STATE_COOKIE = "rb_oauth_state"
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
const googleReady = () => GOOGLE_CLIENT_ID !== "" && GOOGLE_CLIENT_SECRET !== ""
const callbackUrl = () => `${PUBLIC_URL}/auth/google/callback`
/** Cookies are marked Secure when the app is served over https. */
const secure = PUBLIC_URL.startsWith("https://") ? "; Secure" : ""

/** A request the caller got wrong before any operation ran. */
class RequestError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code = status === 404 ? "not_found" : "invalid") {
    super(message)
    this.status = status
    this.code = code
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
  res.end(JSON.stringify(body))
}

function redirect(res: ServerResponse, to: string, cookies: string[] = []) {
  res.writeHead(302, { location: to, "cache-control": "no-store", ...(cookies.length ? { "set-cookie": cookies } : {}) })
  res.end()
}

const respond = (res: ServerResponse, response: OpResponse<unknown>) =>
  send(res, response.ok ? 200 : (STATUS[response.error.code] ?? 400), response)

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=")
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`

interface Caller {
  user: User
  /** api for a key, web for a browser. */
  via: string
}

/** Who sends the request, or null when nobody is signed in. A wrong key is an error, not anonymous. */
async function callerOf(req: IncomingMessage): Promise<Caller | null> {
  const auth = req.headers.authorization ?? ""
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth)
    const user = match ? await userOfKey(match[1]!) : null
    if (!user) throw new RequestError(401, "This API key is unknown or revoked. Create one with: rb key create", "unauthorized")
    return { user, via: "api" }
  }
  const token = cookies(req)[SESSION_COOKIE]
  const fromSession = token ? await userOfSession(token) : null
  if (fromSession) return { user: fromSession, via: "web" }
  if (DEV) {
    const dev = await userByEmail(DEV_EMAIL, "Local developer")
    return { user: { id: dev.id, email: dev.email }, via: "web" }
  }
  return null
}

/** The JSON object sent as the input of an operation. An empty body is `{}`. */
async function readInput(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Refusing other content types keeps a web page on another origin from
  // posting here: a JSON request needs a preflight, which this server never grants.
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new RequestError(415, "Send the input as JSON, with the header content-type: application/json.")
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new RequestError(413, "The body is too large.")
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RequestError(400, "The body is not valid JSON.")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError(400, "The body must be a JSON object: the input of the operation.")
  }
  return parsed as Record<string, unknown>
}

// ------------------------------------------------------------------ auth

async function authMe(req: IncomingMessage, res: ServerResponse) {
  const caller = await callerOf(req).catch(() => null)
  send(res, 200, {
    user: caller ? { email: caller.user.email } : null,
    dev: DEV,
    google: googleReady(),
  })
}

function googleStart(res: ServerResponse) {
  if (!googleReady()) {
    throw new RequestError(503, "Google sign-in is not set up: put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, or run with DEV=true.")
  }
  const state = randomBytes(16).toString("base64url")
  const url = new URL(GOOGLE_AUTH)
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString()
  redirect(res, url.toString(), [cookie(STATE_COOKIE, state, 600)])
}

async function googleCallback(req: IncomingMessage, res: ServerResponse, url: URL) {
  const back = (error?: string) =>
    redirect(res, error ? `${PUBLIC_URL}/?login_error=${encodeURIComponent(error)}` : `${PUBLIC_URL}/`, [cookie(STATE_COOKIE, "", 0)])
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!googleReady()) return back("Google sign-in is not set up.")
  if (!code || !state || state !== cookies(req)[STATE_COOKIE]) return back("The sign-in expired or was not started here. Try again.")

  const token = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(),
      grant_type: "authorization_code",
    }),
  })
  const tokens = (await token.json().catch(() => ({}))) as { access_token?: string }
  if (!token.ok || !tokens.access_token) return back("Google refused the sign-in.")
  const info = await fetch(GOOGLE_USERINFO, { headers: { authorization: `Bearer ${tokens.access_token}` } })
  const profile = (await info.json().catch(() => ({}))) as { email?: string; email_verified?: boolean; name?: string }
  if (!info.ok || !profile.email || profile.email_verified === false) return back("Google gave no verified email.")

  const user = await userByEmail(profile.email, profile.name ?? "")
  const session = await openSession(user.id)
  redirect(res, `${PUBLIC_URL}/`, [cookie(STATE_COOKIE, "", 0), cookie(SESSION_COOKIE, session.token, session.maxAge)])
}

async function logout(req: IncomingMessage, res: ServerResponse) {
  const token = cookies(req)[SESSION_COOKIE]
  if (token) await closeSession(token)
  send(res, 200, { ok: true, result: { signedOut: true } }, { "set-cookie": cookie(SESSION_COOKIE, "", 0) })
}

// --------------------------------------------------------------- routing

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${HOST}`)
  const path = url.pathname
  if (path === "/entrypoint.md" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-cache" })
    return res.end(req.method === "HEAD" ? undefined : entrypoint(PUBLIC_URL))
  }
  if (path === "/auth/me" && req.method === "GET") return authMe(req, res)
  if (path === "/auth/google" && req.method === "GET") return googleStart(res)
  if (path === "/auth/google/callback" && req.method === "GET") return googleCallback(req, res, url)
  if (path === "/auth/logout" && req.method === "POST") return logout(req, res)
  if (!path.startsWith("/api/")) {
    throw new RequestError(404, `No route ${path}. Operations are at POST /api/<entity>.<verb>, their list at GET /api/ops.`)
  }
  const name = path.slice("/api/".length)
  if (name === "ops") {
    if (req.method !== "GET") throw new RequestError(405, "Use GET /api/ops.")
    return respond(res, await runOp("op.list"))
  }
  if (req.method !== "POST") throw new RequestError(405, `Use POST /api/${name} with the input as a JSON body.`)
  const caller = await callerOf(req)
  if (!caller) {
    throw new RequestError(401, "Sign in first: in the web app with Google, or pass an API key (rb --key, RB_KEY).", "unauthorized")
  }
  const input = await readInput(req)
  respond(res, await runOp(name, input, { actor: caller.user.email, via: caller.via, user: caller.user }))
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof RequestError) {
      return send(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    }
    console.error(error)
    send(res, 500, { ok: false, error: { code: "internal", message: "The engine failed. See the API log." } })
  })
})

server.listen(API_PORT, HOST, () =>
  console.log(`Retroback API on http://${HOST}:${API_PORT}${DEV ? ` (DEV: signed in as ${DEV_EMAIL})` : ""}`),
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void db.$disconnect().finally(() => process.exit(0)))
    server.closeAllConnections()
  })
}
