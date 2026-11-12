/**
 * `rb sql`: a read-only SQL query over the rows of one plan.
 *
 * The rows of the plan (its nodes, their items, its events) are copied into a
 * fresh in-memory SQLite database, in a worker thread, and the query runs
 * there. That database holds nothing else, so a query cannot reach another
 * plan or the engine's own tables, whatever it tries. The worker is killed
 * after TIMEOUT_MS. Dialect: SQLite.
 */
import { Worker } from "node:worker_threads"
import { z } from "zod"
import { db } from "../db.ts"
import type { SqlView } from "../types.ts"
import { loadPlan } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const TIMEOUT_MS = 5_000
const MAX_ROWS = 1_000

type Cell = string | number | null
interface Table {
  name: string
  columns: string[]
  rows: Cell[][]
}

/** The tables a query sees, and their columns: shown in the help. */
export const SQL_TABLES = {
  nodes: "ref, seq, title, description, level, milestone, status, size, duration, due, start, finish, ready",
  requirements: "node, slug, text, provided_by, met",
  criteria: "node, slug, text, met",
  resources: "node, slug, kind, name, quantity, unit, provides",
  obstacles: "node, slug, text, fix, status",
  messages: "node, id, author, text, at, edited",
  events: "seq, at, actor, via, op, ok, error, input",
} as const

const bool = (b: boolean) => (b ? 1 : 0)

function table(name: keyof typeof SQL_TABLES, rows: Cell[][]): Table {
  return { name, columns: SQL_TABLES[name].split(", "), rows }
}

async function tablesOf(slug: string | undefined): Promise<{ plan: string; tables: Table[] }> {
  const view = await loadPlan(slug)
  const ns = view.nodes
  const events = await db.event.findMany({ where: { plan: view.slug }, orderBy: { seq: "asc" } })
  return {
    plan: view.slug,
    tables: [
      table(
        "nodes",
        ns.map((n) => [
          n.ref, n.seq, n.title, n.description, n.level, bool(n.level === null), n.status, n.size,
          n.duration, n.due, n.schedule.start, n.schedule.finish, bool(n.ready),
        ]),
      ),
      table("requirements", ns.flatMap((n) => n.requirements.map((r) => [n.ref, r.slug, r.text, r.providedBy, bool(r.met)]))),
      table("criteria", ns.flatMap((n) => n.criteria.map((c) => [n.ref, c.slug, c.text, bool(c.met)]))),
      table(
        "resources",
        ns.flatMap((n) => n.resources.map((r) => [n.ref, r.slug, r.kind, r.name, r.quantity, r.unit, bool(r.provides)])),
      ),
      table("obstacles", ns.flatMap((n) => n.obstacles.map((o) => [n.ref, o.slug, o.text, o.fix, o.status]))),
      table("messages", ns.flatMap((n) => n.messages.map((m) => [n.ref, m.id, m.author, m.text, m.at, bool(m.edited)]))),
      table(
        "events",
        events.map((e) => [e.seq, e.at.toISOString(), e.actor, e.via, e.op, bool(e.ok), e.error, JSON.stringify(e.input)]),
      ),
    ],
  }
}

/** Plain JS, run with eval in the worker: no TypeScript loader there. */
const WORKER = `
const { parentPort, workerData } = require("node:worker_threads")
const { DatabaseSync } = require("node:sqlite")
const { tables, query, max } = workerData
try {
  const sql = new DatabaseSync(":memory:")
  for (const t of tables) {
    sql.exec("CREATE TABLE " + t.name + " (" + t.columns.map((c) => '"' + c + '"').join(", ") + ")")
    const insert = sql.prepare("INSERT INTO " + t.name + " VALUES (" + t.columns.map(() => "?").join(", ") + ")")
    sql.exec("BEGIN")
    for (const row of t.rows) insert.run(...row)
    sql.exec("COMMIT")
  }
  sql.exec("PRAGMA query_only = ON")
  // Wrapped as a subquery: only a single SELECT (or WITH ... SELECT) parses.
  const stmt = sql.prepare("SELECT * FROM (\\n" + query + "\\n) LIMIT " + (max + 1))
  const columns = stmt.columns().map((c) => c.name)
  stmt.setReturnArrays?.(true)
  const raw = stmt.all()
  const rows = raw.map((r) => (Array.isArray(r) ? r : columns.map((c) => r[c])))
    .map((r) => r.map((v) => (typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v)))
  parentPort.postMessage({ ok: true, columns, rows })
} catch (error) {
  parentPort.postMessage({ ok: false, message: String(error && error.message ? error.message : error) })
}
`

type WorkerAnswer = { ok: true; columns: string[]; rows: Cell[][] } | { ok: false; message: string }

function runIsolated(tables: Table[], query: string): Promise<WorkerAnswer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { eval: true, workerData: { tables, query, max: MAX_ROWS } })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new OpError(`The query took more than ${TIMEOUT_MS / 1000} s and was stopped.`))
    }, TIMEOUT_MS)
    worker.once("message", (answer: WorkerAnswer) => {
      clearTimeout(timer)
      void worker.terminate()
      resolve(answer)
    })
    worker.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export const sqlOps = [
  defineOp({
    name: "sql.query",
    summary: `Run a read-only SQL query (SQLite dialect, a single SELECT) over the rows of one plan. Tables: ${Object.entries(SQL_TABLES)
      .map(([t, cols]) => `${t}(${cols})`)
      .join("; ")}. Booleans are 0/1, dates YYYY-MM-DD, events.input is JSON (use json_extract). ${MAX_ROWS} rows and ${TIMEOUT_MS / 1000} s at most. From the CLI: rb sql "<query>", printed as CSV.`,
    mutates: false,
    input: z.strictObject({
      plan: planFlag,
      query: z.string().trim().min(1).max(10_000).describe("The SELECT to run, e.g. SELECT ref, title FROM nodes WHERE ready = 1."),
    }),
    run: async ({ plan, query }) => {
      const { plan: slug, tables } = await tablesOf(plan)
      const clean = query.replace(/;\s*$/, "")
      const answer = await runIsolated(tables, clean)
      if (!answer.ok) throw new OpError(`SQL: ${answer.message}. Only a single SELECT over ${Object.keys(SQL_TABLES).join(", ")}.`)
      const cut = answer.rows.length > MAX_ROWS
      const result: SqlView = { plan: slug, columns: answer.columns, rows: answer.rows.slice(0, MAX_ROWS), cut }
      return result
    },
  }),
]
