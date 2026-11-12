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
 *   --api <url>                            the engine API to talk to (or RB_API; default http://127.0.0.1:7979)
 *   --key <rb_...>                         the API key rb acts with (or RB_KEY). The flags win over the variables.
 *   --plan <slug>                          on any command that takes a plan; RB_PLAN gives the default
 *
 * RB_API, RB_KEY and RB_PLAN are read from the environment, else from the
 * nearest .env in the current folder or above, else from ~/.config/rb/.env.
 * `rb config` shows what was found, and where.
 *
 * rb never touches the database: every operation goes through the API, as the
 * user of the key, so access checks and the event log always apply.
 *
 * Exit code: 0 on success, 1 on error, 3 when `plan check` finds an error.
 */
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseEnv } from "node:util"
import { camel, kebab } from "./flags.ts"
import { summariseNode } from "./summary.ts"
import type {
  ApiKeyView,
  CheckItem,
  CheckView,
  EventView,
  Gap,
  ItemList,
  MemberView,
  MessagePage,
  MessageView,
  NodePage,
  NodeSummary,
  NodeView,
  OpInfo,
  OpResponse,
  PlanBrief,
  PlanSummary,
  PlanView,
  ReplayView,
  RequirementView,
  ResourceTotal,
  ResourceTotals,
  ResourceView,
  UnlockView,
  UserView,
} from "./types.ts"

/** Where operations run: always an engine API, as the user of the API key. */
interface Backend {
  infos: () => Promise<OpInfo[]>
  run: (name: string, input: Record<string, unknown>) => Promise<OpResponse<unknown>>
}

const DEFAULT_API = "http://127.0.0.1:7979"

const SETTINGS = ["RB_API", "RB_KEY", "RB_PLAN"] as const
type Setting = (typeof SETTINGS)[number]

interface Found {
  value: string | undefined
  /** Where it came from: a flag, the environment, a .env file, or the default. */
  from: string
}

/** The .env files rb reads, nearest first: the current folder and its parents, then ~/.config/rb/.env. */
function envFiles(): string[] {
  const files: string[] = []
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    files.push(path.join(dir, ".env"))
    if (path.dirname(dir) === dir) break
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  files.push(path.join(config, "rb", ".env"))
  return files.filter((file, i) => files.indexOf(file) === i && existsSync(file))
}

/**
 * RB_API, RB_KEY, RB_PLAN: a variable set in the environment wins, even empty
 * (empty means none); otherwise the first .env file that sets it.
 */
function readSettings(): Record<Setting, Found> {
  const out = {} as Record<Setting, Found>
  for (const name of SETTINGS) {
    if (process.env[name] !== undefined) out[name] = { value: process.env[name] || undefined, from: "environment" }
  }
  for (const file of envFiles()) {
    let parsed: Record<string, string | undefined>
    try {
      parsed = parseEnv(readFileSync(file, "utf8")) as Record<string, string | undefined>
    } catch {
      continue
    }
    for (const name of SETTINGS) {
      if (!out[name] && parsed[name] !== undefined) out[name] = { value: parsed[name] || undefined, from: file }
    }
  }
  for (const name of SETTINGS) out[name] ??= { value: undefined, from: "not set" }
  return out
}

class Unreachable extends Error {}

function remoteBackend(base: string, key: string | undefined): Backend {
  const root = base.replace(/\/+$/, "")
  const auth: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {}
  const request = async (path: string, init?: RequestInit): Promise<OpResponse<unknown>> => {
    let res: Response
    try {
      res = await fetch(`${root}/api/${path}`, { ...init, headers: { ...auth, ...(init?.headers as Record<string, string> | undefined) } })
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
  }
}

/** `--<name> <value>` or `--<name>=<value>`, removed from the arguments. */
function takeOption(argv: string[], name: string, example: string): { value: string | undefined; rest: string[] } {
  const rest: string[] = []
  let value: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === `--${name}`) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) throw new UsageError(`--${name} needs a value, e.g. --${name} ${example}.`)
      value = next
      i++
    } else if (arg.startsWith(`--${name}=`)) value = arg.slice(name.length + 3)
    else rest.push(arg)
  }
  return { value, rest }
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

function renderNodes(nodes: NodeSummary[]): string {
  if (nodes.length === 0) return "No node."
  return table([
    ["REF", "LEVEL", "GAP", "FROM", "STATUS", "SIZE", "CRIT", "REQ", "TITLE"],
    ...nodes.map((n) => [
      n.ref,
      num(n.level),
      gapText(n.gap),
      n.gap.from,
      n.status,
      String(n.size),
      `${n.criteria.met}/${n.criteria.total}`,
      `${n.requirements.met}/${n.requirements.total}`,
      clip(n.title, 60),
    ]),
  ])
}

/** A page of nodes, and the command for the next one when it is cut. */
function renderPage(page: NodePage, command: string): string {
  if (page.total === 0) return "No node. Create the target with: rb node create --title <text>"
  const lines = [renderNodes(page.nodes)]
  if (page.next) {
    lines.push("", `${page.nodes.length} of ${page.total} shown. Next page: ${command} --after ${page.next}`)
  }
  return lines.join("\n")
}

const clip = (s: string, max: number) => {
  const line = s.replace(/\s+/g, " ")
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Messages shown under a node; the rest are a `message list` away. */
const NODE_MESSAGES = 5

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
    ...list(
      n.messages.length > NODE_MESSAGES
        ? `Messages (last ${NODE_MESSAGES} of ${n.messages.length}; all: rb message list --plan ${n.plan} --node ${n.ref} --last ${n.messages.length})`
        : "Messages",
      n.messages.slice(-NODE_MESSAGES).map(messageLine),
    ),
  ].join("\n")
}

const messageLine = (m: MessageView) =>
  `${m.id}  ${m.author}, ${m.at.slice(0, 16).replace("T", " ")}${m.edited ? " (edited)" : ""}: ${m.text.replace(/\n/g, "\n          ")}`

function renderMessages(page: MessagePage): string {
  if (page.total === 0) return "No message."
  const lines = page.messages.map(messageLine)
  if (page.messages.length < page.total) {
    lines.unshift(`Last ${page.messages.length} of ${page.total}. More: --last ${page.total}`, "")
  }
  return lines.join("\n")
}

const renderResourceTotals = (resources: ResourceTotal[]) =>
  resources.length === 0
    ? "No resource."
    : table([
        ["KIND", "NAME", "QUANTITY", "NODES"],
        ...resources.map((r) => [r.kind, r.name, `${num(r.quantity)} ${r.unit}`, r.nodes.join(", ")]),
      ])

const planHead = (p: PlanSummary) => [
  `${p.slug}  ${p.title}`,
  `Target: ${p.target}`,
  `${p.metric}: ${num(p.presentValue)} -> ${num(p.targetValue)} ${p.unit}, steps of ${num(p.gapPercent)}% at most`,
]

/** `plan show --full`: everything. */
function renderPlan(p: PlanView): string {
  return [
    ...planHead(p),
    "",
    renderNodes(p.nodes.map(summariseNode)),
    ...(p.resources.length ? ["", "Resources", renderResourceTotals(p.resources)] : []),
    "",
    renderCheck(p.check),
  ].join("\n")
}

function renderBrief(p: PlanBrief): string {
  const { errors, warnings } = p.check
  return [
    ...planHead(p),
    "",
    renderPage(p.nodes, `rb plan show --plan ${p.slug}`),
    "",
    `Check: ${p.check.ok ? "ok" : "failed"} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}). Details: rb plan check --plan ${p.slug}`,
    `Resources: rb resource list --plan ${p.slug}`,
  ].join("\n")
}

function renderItems(name: string, list: ItemList<unknown>): string {
  if (list.items.length === 0) return `${list.node} has none.`
  if (name === "requirement.list") {
    return table([
      ["MET", "SLUG", "PROVIDED BY", "TEXT"],
      ...(list.items as RequirementView[]).map((r) => [box(r.met), r.slug, r.providedBy, clip(r.text, 80)]),
    ])
  }
  if (name === "resource.list") {
    return table([
      ["SLUG", "KIND", "NAME", "QUANTITY"],
      ...(list.items as ResourceView[]).map((r) => [r.slug, r.kind, r.name, `${num(r.quantity)} ${r.unit}`]),
    ])
  }
  return table([["MET", "SLUG", "TEXT"], ...(list.items as CheckItem[]).map((c) => [box(c.met), c.slug, clip(c.text, 80)])])
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
  if (name === "op.list") return [SETTINGS_HELP, "", ...(result as OpInfo[]).map((info) => `## rb ${info.name.replace(".", " ")}\n${renderOpHelp(info)}`)].join("\n\n")
  if (name === "message.list") return renderMessages(result as MessagePage)
  if (name === "node.list") {
    const page = result as NodePage
    return renderPage(page, `rb node list --plan ${page.plan}`)
  }
  if (name === "criterion.list" || name === "requirement.list") return renderItems(name, result as ItemList<unknown>)
  if (name === "resource.list") {
    return "items" in (result as object)
      ? renderItems(name, result as ItemList<unknown>)
      : renderResourceTotals((result as ResourceTotals).resources)
  }
  if (name === "plan.show" || name === "plan.create" || name === "plan.update") {
    const p = result as PlanView | PlanBrief
    return Array.isArray(p.nodes) ? renderPlan(p as PlanView) : renderBrief(p as PlanBrief)
  }
  if (name === "user.me") {
    const me = result as UserView
    return [`${me.email}${me.name ? `  (${me.name})` : ""}`, ...me.plans.map((p) => `  ${p.plan}  ${p.role}`)].join("\n")
  }
  if (name === "plan.members" || name === "plan.share" || name === "plan.unshare") {
    return table([["EMAIL", "ROLE", "NAME"], ...(result as MemberView[]).map((m) => [m.email, m.role, m.name])])
  }
  if (name === "key.list") {
    const keys = result as ApiKeyView[]
    if (keys.length === 0) return "No API key. Create one with: rb key create --name <name>"
    return table([
      ["NAME", "PREFIX", "CREATED", "LAST USED", "STATE"],
      ...keys.map((k) => [k.name, k.prefix, k.createdAt.slice(0, 16).replace("T", " "), k.lastUsedAt?.slice(0, 16).replace("T", " ") ?? "never", k.revoked ? "revoked" : "active"]),
    ])
  }
  if (name === "key.create") {
    const k = result as ApiKeyView
    return [`Key "${k.name}" created. Its secret, shown only now:`, "", `  ${k.secret}`, "", "Use it with: export RB_KEY=<secret>"].join("\n")
  }
  if (name === "key.revoke") return `Key "${(result as ApiKeyView).name}" revoked.`
  if (name === "event.list") {
    const events = result as EventView[]
    if (events.length === 0) return "No event."
    return table([
      ["SEQ", "AT", "ACTOR", "VIA", "OP", "PLAN", "RESULT"],
      ...events.map((e) => [
        String(e.seq),
        e.at.slice(0, 19).replace("T", " "),
        e.actor,
        e.via,
        e.op,
        e.plan ?? "",
        e.ok ? "ok" : (e.error ?? "error"),
      ]),
    ])
  }
  if (name === "event.replay") {
    const r = result as ReplayView
    const head = `Replayed ${r.replayed} events of "${r.from}" into "${r.as}", up to event ${r.upTo}.`
    return r.plan ? [head, "", renderBrief(r.plan)].join("\n") : `${head}\nThe history ends with the plan deleted.`
  }
  if (name === "node.unlock") {
    const u = result as UnlockView
    if (u.nodes.length === 0) return `Nothing to unlock: ${u.target} is done.`
    return [`To reach ${u.target}, tackle now:`, renderNodes(u.nodes), "", `Size left: ${u.size} (heaviest path, perfect parallelism)`].join("\n")
  }
  if (Array.isArray(result)) {
    const first = result[0] as Record<string, unknown> | undefined
    if (!first) {
      if (name === "plan.list") return renderPlans([])
      return "(nothing)"
    }
    if ("cli" in first) return renderOps(result as OpInfo[])
    if ("nodeCount" in first) return renderPlans(result as PlanSummary[])
  } else if (result && typeof result === "object") {
    if ("ref" in result) return renderNode(result as NodeView)
    if ("issues" in result) return renderCheck(result as CheckView)
    if ("deleted" in result) return `Deleted ${String(result.deleted)}.`
  }
  return JSON.stringify(result, null, 2)
}

// --------------------------------------------------------------------- main

const SETTINGS_HELP = [
  "Settings, read from the environment, else the nearest .env (current folder or above), else ~/.config/rb/.env:",
  `  RB_API   the engine API, default ${DEFAULT_API}          (flag --api)`,
  "  RB_KEY   your API key rb_..., from the web app or rb key create   (flag --key)",
  "  RB_PLAN  the plan used when --plan is left out           (flag --plan)",
  "rb config shows what was found, and where. Add --json to any command for the raw answer.",
].join("\n")

const overview = (infos: OpInfo[]) =>
  [
    "rb: plan backward from a target to the present.",
    "",
    "  rb <entity> <verb> [--flag value]...",
    "  rb <entity> <verb> --help     the flags of one command",
    "  rb op list                    every command with all its flags",
    "",
    SETTINGS_HELP,
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
  let key: string | undefined
  try {
    const a = takeOption(raw, "api", DEFAULT_API)
    const k = takeOption(a.rest, "key", "rb_...")
    ;({ value: api } = a)
    ;({ value: key, rest: argv } = k)
  } catch (error) {
    if (error instanceof UsageError) return fail("invalid", error.message)
    throw error
  }
  const settings = readSettings()
  if (api !== undefined) settings.RB_API = { value: api, from: "--api" }
  if (key !== undefined) settings.RB_KEY = { value: key, from: "--key" }
  if (!settings.RB_API.value) settings.RB_API = { value: DEFAULT_API, from: "default" }
  api = settings.RB_API.value!
  key = settings.RB_KEY.value

  if (argv.filter((a) => a !== "--json")[0] === "config") {
    const shown = {
      RB_API: settings.RB_API,
      RB_KEY: { ...settings.RB_KEY, value: key ? `${key.slice(0, 7)}…` : undefined },
      RB_PLAN: settings.RB_PLAN,
    }
    if (json) console.log(JSON.stringify({ ok: true, result: shown }, null, 2))
    else {
      console.log(table(Object.entries(shown).map(([name, s]) => [name, s.value ?? "(none)", s.from])))
      console.log(["", "Files read, nearest first:", ...(envFiles().map((f) => `  ${f}`) || []), ...(envFiles().length ? [] : ["  (none)"])].join("\n"))
    }
    return 0
  }

  if (!/^https?:\/\/[^/\s]+/.test(api)) return fail("invalid", `RB_API (${settings.RB_API.from}) must be an http(s) URL, got "${api}".`)
  const backend = remoteBackend(api, key)
  try {
    return await runCli(argv, json, backend, fail, settings.RB_PLAN.value)
  } catch (error) {
    if (error instanceof Unreachable) return fail("unreachable", error.message)
    throw error
  }
}

async function runCli(
  argv: string[],
  json: boolean,
  backend: Backend,
  fail: (code: string, message: string) => number,
  defaultPlan: string | undefined,
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
  // RB_PLAN fills in --plan where it may be left out. A required --plan (plan delete) is never guessed.
  const planProp = info.input.properties?.["plan"]
  if (defaultPlan && planProp && !(info.input.required ?? []).includes("plan") && input["plan"] === undefined) {
    input["plan"] = defaultPlan
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
