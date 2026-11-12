/**
 * rb: the command line of the engine.
 *
 *   rb <entity> <verb> [--flag value]...   run an operation
 *   rb help                                list the operations
 *   rb <entity> <verb> --help              show the flags of one operation
 *   --json                                 print the raw response (for scripts and agents)
 *
 * Nothing here knows a specific operation: commands and flags come from the
 * registry (ops/index.ts), the same one the API serves to the web app.
 *
 *   --api <url>                            talk to a running engine API instead of the database
 *                                          (or set RB_API; the flag wins)
 *
 * Exit code: 0 on success, 1 on error, 3 when `plan check` finds an error.
 */
import { camel, kebab } from "./flags.ts"
import type { CheckView, Gap, MessageView, NodeView, OpInfo, OpResponse, PlanSummary, PlanView, UnlockView } from "./types.ts"

/** Where operations run: in this process on the database, or on a remote engine API. */
interface Backend {
  infos: () => Promise<OpInfo[]>
  run: (name: string, input: Record<string, unknown>) => Promise<OpResponse<unknown>>
  close: () => Promise<void>
}

async function localBackend(): Promise<Backend> {
  // Loaded only here, so remote mode needs neither the database nor its client.
  const [{ db }, { opInfos, runOp }] = await Promise.all([import("./db.ts"), import("./ops/index.ts")])
  return { infos: async () => opInfos(), run: runOp, close: () => db.$disconnect() }
}

class Unreachable extends Error {}

function remoteBackend(base: string): Backend {
  const root = base.replace(/\/+$/, "")
  const request = async (path: string, init?: RequestInit): Promise<OpResponse<unknown>> => {
    let res: Response
    try {
      res = await fetch(`${root}/api/${path}`, init)
    } catch {
      throw new Unreachable(`The engine API does not answer at ${root}.`)
    }
    try {
      return (await res.json()) as OpResponse<unknown>
    } catch {
      throw new Unreachable(`${root} answered ${res.status} without JSON: is it a Retroback engine API?`)
    }
  }
  return {
    infos: async () => {
      const listed = await request("ops")
      if (!listed.ok) throw new Unreachable(`${root}/api/ops: ${listed.error.message}`)
      return listed.result as OpInfo[]
    },
    run: (name, input) =>
      request(name, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    close: async () => {},
  }
}

/** `--api <url>` or `--api=<url>`, removed from the arguments. */
function takeApi(argv: string[]): { api: string | undefined; rest: string[] } {
  const rest: string[] = []
  let api: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--api") {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) throw new UsageError("--api needs a URL, e.g. --api http://127.0.0.1:7979.")
      api = next
      i++
    } else if (arg.startsWith("--api=")) api = arg.slice("--api=".length)
    else rest.push(arg)
  }
  if (api !== undefined && !/^https?:\/\/[^/\s]+/.test(api)) throw new UsageError(`--api must be an http(s) URL, got "${api}".`)
  return { api, rest }
}

class UsageError extends Error {}

/** Turns `--flag value` pairs into the input of an operation, typed from its schema. */
function parseFlags(info: OpInfo, args: string[]): Record<string, unknown> {
  const props = info.input.properties ?? {}
  const input: Record<string, unknown> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith("--")) throw new UsageError(`Unexpected "${arg}": values are passed as flags.`)
    const eq = arg.indexOf("=")
    const key = camel(eq === -1 ? arg.slice(2) : arg.slice(2, eq))
    const flag = `--${kebab(key)}`
    const prop = props[key]
    if (!prop) throw new UsageError(`Unknown flag ${flag}.`)

    let raw = eq === -1 ? undefined : arg.slice(eq + 1)
    if (raw === undefined) {
      const next = args[i + 1]
      if (prop.type === "boolean" && next !== "true" && next !== "false") raw = "true"
      else if (next === undefined) throw new UsageError(`${flag} needs a value.`)
      else {
        raw = next
        i++
      }
    }

    let value: unknown = raw
    if (prop.type === "number" || prop.type === "integer") {
      value = Number(raw)
      if (raw.trim() === "" || !Number.isFinite(value)) throw new UsageError(`${flag} must be a number, got "${raw}".`)
    } else if (prop.type === "boolean") {
      if (raw !== "true" && raw !== "false") throw new UsageError(`${flag} must be true or false, got "${raw}".`)
      value = raw === "true"
    }

    if (prop.type === "array") {
      input[key] = [...((input[key] as unknown[] | undefined) ?? []), value]
    } else if (key in input) {
      throw new UsageError(`${flag} is given twice.`)
    } else {
      input[key] = value
    }
  }
  return input
}

// ---------------------------------------------------------------- rendering

const num = (n: number) => String(Number(n.toPrecision(12)))

function table(rows: string[][]): string {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)))
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd()).join("\n")
}

const gapText = (gap: Gap) =>
  gap.percent === null ? "n/a" : `${gap.percent > 0 ? "+" : ""}${gap.percent}%${gap.ok ? "" : " !"}`

const box = (met: boolean) => (met ? "[x]" : "[ ]")

function renderCheck(check: CheckView): string {
  const errors = check.issues.filter((i) => i.severity === "error").length
  const warnings = check.issues.length - errors
  const head = `Check: ${check.ok ? "ok" : "failed"} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`
  if (check.issues.length === 0) return head
  return [head, table(check.issues.map((i) => [`  ${i.severity}`, i.code, i.message]))].join("\n")
}

function renderNodes(nodes: NodeView[]): string {
  if (nodes.length === 0) return "No node yet. Create the target with: rb node create --title <text>"
  return table([
    ["REF", "LEVEL", "GAP", "FROM", "STATUS", "SIZE", "TITLE"],
    ...nodes.map((n) => [n.ref, num(n.level), gapText(n.gap), n.gap.from, n.status, String(n.size), n.title]),
  ])
}

function renderNode(n: NodeView): string {
  const list = (title: string, lines: string[]) => [``, title, ...(lines.length ? lines.map((l) => `  ${l}`) : ["  (none)"])]
  return [
    `${n.ref}  ${n.title}  [${n.status}]`,
    `level ${num(n.level)}, ${gapText(n.gap)} from ${n.gap.from} (${num(n.gap.base)}), size ${n.size}/100`,
    ...(n.description ? ["", n.description] : []),
    ...list("Success criteria", n.criteria.map((c) => `${box(c.met)} ${c.slug}: ${c.text}`)),
    ...list(
      "Requirements",
      n.requirements.map((r) => `${box(r.met)} ${r.slug}: ${r.text}  <- ${r.providedBy}`),
    ),
    ...list("Requires (providers of its requirements)", n.dependsOn.length ? [n.dependsOn.join(", ")] : []),
    ...list("Enables", n.enables.length ? [n.enables.join(", ")] : []),
    ...list("Resources", n.resources.map((r) => `${r.slug}: ${r.kind}, ${r.name}, ${num(r.quantity)} ${r.unit}`)),
    ...list("Messages", n.messages.map(messageLine)),
  ].join("\n")
}

const messageLine = (m: MessageView) =>
  `${m.id}  ${m.author}, ${m.at.slice(0, 16).replace("T", " ")}${m.edited ? " (edited)" : ""}: ${m.text.replace(/\n/g, "\n          ")}`

const renderMessages = (messages: MessageView[]) =>
  messages.length === 0 ? "No message." : messages.map(messageLine).join("\n")

function renderPlan(p: PlanView): string {
  return [
    `${p.slug}  ${p.title}`,
    `Target: ${p.target}`,
    `${p.metric}: ${num(p.presentValue)} -> ${num(p.targetValue)} ${p.unit}, steps of ${num(p.gapPercent)}% at most`,
    "",
    renderNodes(p.nodes),
    ...(p.resources.length
      ? [
          "",
          "Resources",
          table(p.resources.map((r) => [`  ${r.kind}`, r.name, `${num(r.quantity)} ${r.unit}`, r.nodes.join(", ")])),
        ]
      : []),
    "",
    renderCheck(p.check),
  ].join("\n")
}

const renderPlans = (plans: PlanSummary[]) =>
  plans.length === 0
    ? "No plan yet. Create one with: rb plan create"
    : table([
        ["SLUG", "NODES", "METRIC", "TITLE"],
        ...plans.map((p) => [
          p.slug,
          String(p.nodeCount),
          `${p.metric} ${num(p.presentValue)} -> ${num(p.targetValue)} ${p.unit}`,
          p.title,
        ]),
      ])

function renderOps(infos: OpInfo[]): string {
  const lines: string[] = []
  let entity = ""
  for (const info of infos) {
    const [head] = info.name.split(".")
    if (head !== entity) {
      if (entity) lines.push("")
      entity = head!
    }
    lines.push(info.cli, `    ${info.summary}`)
  }
  return lines.join("\n")
}

function renderOpHelp(info: OpInfo): string {
  const required = new Set(info.input.required ?? [])
  const rows = Object.entries(info.input.properties ?? {}).map(([key, prop]) => [
    `  --${kebab(key)}`,
    prop.enum ? prop.enum.join("|") : prop.type === "array" ? "text" : (prop.type ?? "text"),
    required.has(key) ? "required" : prop.type === "array" ? "repeatable" : "",
    prop.description ?? "",
  ])
  return [info.summary, "", info.cli, ...(rows.length ? ["", table(rows)] : [])].join("\n")
}

/** Picks the rendering from the shape of the operation's result. */
function render(name: string, result: unknown): string {
  if (name === "message.list") return renderMessages(result as MessageView[])
  if (name === "node.unlock") {
    const u = result as UnlockView
    if (u.nodes.length === 0) return `Nothing to unlock: ${u.target} is done.`
    return [`To reach ${u.target}, tackle now:`, renderNodes(u.nodes), "", `Size left: ${u.size} (heaviest path, perfect parallelism)`].join("\n")
  }
  if (Array.isArray(result)) {
    const first = result[0] as Record<string, unknown> | undefined
    if (!first) {
      if (name === "plan.list") return renderPlans([])
      if (name === "node.list") return renderNodes([])
      return "(nothing)"
    }
    if ("cli" in first) return renderOps(result as OpInfo[])
    if ("nodeCount" in first) return renderPlans(result as PlanSummary[])
    if ("ref" in first) return renderNodes(result as NodeView[])
  } else if (result && typeof result === "object") {
    if ("nodes" in result) return renderPlan(result as PlanView)
    if ("ref" in result) return renderNode(result as NodeView)
    if ("issues" in result) return renderCheck(result as CheckView)
    if ("deleted" in result) return `Deleted ${String(result.deleted)}.`
  }
  return JSON.stringify(result, null, 2)
}

// --------------------------------------------------------------------- main

const overview = (infos: OpInfo[]) =>
  [
    "rb: plan backward from a target to the present.",
    "",
    "  rb <entity> <verb> [--flag value]...",
    "  rb <entity> <verb> --help",
    "  add --json to get the raw response",
    "  add --api <url> (or set RB_API) to use a running engine API instead of the database",
    "",
    renderOps(infos),
  ].join("\n")

async function main(): Promise<number> {
  const raw = process.argv.slice(2)
  const json = raw.includes("--json")
  const fail = (code: string, message: string) => {
    if (json) console.log(JSON.stringify({ ok: false, error: { code, message } }, null, 2))
    else console.error(`error: ${message}`)
    return 1
  }

  let argv: string[]
  let api: string | undefined
  try {
    ;({ api, rest: argv } = takeApi(raw))
  } catch (error) {
    if (error instanceof UsageError) return fail("invalid", error.message)
    throw error
  }
  api ??= process.env.RB_API || undefined
  const backend = api ? remoteBackend(api) : await localBackend()
  try {
    return await runCli(argv, json, backend, fail)
  } catch (error) {
    if (error instanceof Unreachable) return fail("unreachable", error.message)
    throw error
  } finally {
    await backend.close()
  }
}

async function runCli(
  argv: string[],
  json: boolean,
  backend: Backend,
  fail: (code: string, message: string) => number,
): Promise<number> {
  const help = argv.includes("--help") || argv.includes("-h")
  const args = argv.filter((a) => a !== "--json" && a !== "--help" && a !== "-h")
  const infos = await backend.infos()
  const words: string[] = []
  while (words.length < 2 && args[0] !== undefined && !args[0].startsWith("-")) words.push(args.shift()!)
  if (words.length === 0 || words[0] === "help") {
    console.log(overview(infos))
    return 0
  }

  const name = words.join(".")
  const info = infos.find((i) => i.name === name)
  if (!info) {
    const verbs = infos.filter((i) => i.name.startsWith(`${words[0]}.`)).map((i) => i.name.split(".")[1])
    return fail(
      "not_found",
      verbs.length
        ? `No command "rb ${words.join(" ")}". For ${words[0]}: ${verbs.join(", ")}.`
        : `No command "rb ${words.join(" ")}". List them with: rb help`,
    )
  }
  if (help) {
    console.log(renderOpHelp(info))
    return 0
  }

  let input: Record<string, unknown>
  try {
    input = parseFlags(info, args)
  } catch (error) {
    if (error instanceof UsageError) return fail("invalid", `${error.message} Usage: ${info.cli}`)
    throw error
  }

  const response = await backend.run(name, input)
  if (!response.ok) return fail(response.error.code, response.error.message)
  console.log(json ? JSON.stringify(response, null, 2) : render(name, response.result))
  return name === "plan.check" && !(response.result as CheckView).ok ? 3 : 0
}

main()
  .then((code) => (process.exitCode = code))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
