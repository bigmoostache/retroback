/**
 * The HTTP API of the engine, built from the registry (ops/index.ts).
 *
 *   GET  /api/ops               every operation with its input (same as `rb op list`)
 *   POST /api/<entity>.<verb>   run an operation; the JSON body is its input
 *
 * The answer is always an OpResponse, the same one `rb --json` prints.
 * Status: 200 ok, 400 invalid, 404 not_found, 409 conflict, 500 bug.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { db } from "./db.ts"
import { API_PORT } from "./env.ts"
import { runOp } from "./ops/index.ts"
import type { OpResponse } from "./types.ts"

const HOST = "127.0.0.1"
const MAX_BODY = 1_000_000
const STATUS: Record<string, number> = { invalid: 400, not_found: 404, conflict: 409 }

/** A request the caller got wrong before any operation ran. */
class RequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body: OpResponse<unknown>) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

const respond = (res: ServerResponse, response: OpResponse<unknown>) =>
  send(res, response.ok ? 200 : (STATUS[response.error.code] ?? 400), response)

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

async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", `http://${HOST}`).pathname
  if (!path.startsWith("/api/")) {
    throw new RequestError(404, `No route ${path}. Operations are at POST /api/<entity>.<verb>, their list at GET /api/ops.`)
  }
  const name = path.slice("/api/".length)
  if (name === "ops") {
    if (req.method !== "GET") throw new RequestError(405, "Use GET /api/ops.")
    return respond(res, await runOp("op.list"))
  }
  if (req.method !== "POST") throw new RequestError(405, `Use POST /api/${name} with the input as a JSON body.`)
  respond(res, await runOp(name, await readInput(req)))
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof RequestError) {
      const code = error.status === 404 ? "not_found" : "invalid"
      return send(res, error.status, { ok: false, error: { code, message: error.message } })
    }
    console.error(error)
    send(res, 500, { ok: false, error: { code: "internal", message: "The engine failed. See the API log." } })
  })
})

server.listen(API_PORT, HOST, () => console.log(`Retroback API on http://${HOST}:${API_PORT}`))

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void db.$disconnect().finally(() => process.exit(0)))
    server.closeAllConnections()
  })
}
