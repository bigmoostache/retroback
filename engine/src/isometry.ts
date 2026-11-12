/**
 * Checks that the CLI and the API do the same thing: `pnpm check:isometry`
 * (the API must be running: `pnpm api`).
 *
 * It plays one scenario twice on a throwaway plan, once through `rb --json`
 * and once through POST /api/<op>, and compares the answers step by step.
 * The scenario must use every operation of the registry, so adding an
 * operation without a step here fails the check.
 */
import { execFile } from "node:child_process"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { db } from "./db.ts"
import { API_PORT } from "./env.ts"
import { kebab, toCommand } from "./flags.ts"
import { opInfos, runOp } from "./ops/index.ts"
import type { CheckView, OpResponse, PlanSummary } from "./types.ts"

const PLAN = "isometry-check"
const API = `http://127.0.0.1:${API_PORT}`
const RB = path.resolve(import.meta.dirname, "../../bin/rb")
/** HTTP status of each error code (see server.ts). */
const STATUS: Record<string, number> = { invalid: 400, not_found: 404, conflict: 409 }

type Input = Record<string, unknown>
type Outcome = "ok" | "invalid" | "not_found" | "conflict"
/** An operation, its input, and how it must end ("ok" when omitted). */
type Step = [op: string, input: Input, expect?: Outcome]

const plan = { plan: PLAN }
const n2 = { plan: PLAN, node: "N2" }

const STEPS: Step[] = [
  ["op.list", {}],
  [
    "plan.create",
    { slug: PLAN, title: "Isometry check", target: "Reach 103.", metric: "score", unit: "points", presentValue: 100, targetValue: 103 },
  ],
  ["plan.list", {}],
  ["node.create", { ...plan, title: "Target", criterion: ["Score is 103 for 2 weeks."], requirement: ["Budget approved."] }],
  ["node.create", { ...plan, title: "Step before", description: "What the target requires.", enables: ["N1"], size: 70 }],
  ["node.create", { ...plan, title: "First step", enables: ["N2"], level: 101 }],
  ["node.create", { ...plan, title: "Side step", level: 100.5 }],
  ["node.create", { ...plan, title: "Bad size", level: 100.2, size: 101 }, "invalid"],
  ["requirement.add", { ...n2, text: "Side work done.", providedBy: ["N4"] }],
  ["requirement.link", { ...n2, index: 2, by: "N4" }, "conflict"],
  ["requirement.link", { plan: PLAN, node: "N1", index: 1, by: "N1" }, "conflict"],
  // N2 requires N4, so N4 cannot require N2: that would close a loop.
  ["requirement.add", { plan: PLAN, node: "N4", text: "Loop.", providedBy: ["N2"] }, "conflict"],
  ["requirement.update", { ...n2, index: 2, met: true }, "conflict"],
  ["node.unlock", { plan: PLAN, ref: "N1" }],
  ["requirement.unlink", { ...n2, index: 2, by: "N4" }],
  ["requirement.unlink", { ...n2, index: 2, by: "N4" }, "not_found"],
  ["requirement.link", { ...n2, index: 2, by: "N4" }],
  ["requirement.remove", { ...n2, index: 2 }],
  ["criterion.add", { ...n2, text: "Score is 102 for 2 weeks." }],
  ["criterion.add", { ...n2, text: "To remove." }],
  ["criterion.update", { ...n2, index: 1, met: true }],
  ["criterion.remove", { ...n2, index: 2 }],
  ["criterion.remove", { ...n2, index: 2 }, "not_found"],
  ["requirement.add", { ...n2, text: "Data access granted." }],
  ["requirement.update", { ...n2, index: 2, text: "Data access granted by the 1st.", met: true }],
  ["requirement.remove", { ...n2, index: 2 }],
  ["resource.add", { ...n2, kind: "human", name: "analyst", quantity: 2.5, unit: "person-days" }],
  ["resource.add", { ...n2, kind: "capital", name: "licence", quantity: 300, unit: "EUR" }],
  ["resource.update", { ...n2, index: 1, quantity: 3 }],
  ["resource.remove", { ...n2, index: 2 }],
  ["message.add", { ...n2, text: "Who owns the data access?", author: "guillaume" }],
  ["message.add", { ...n2, text: "Ops lead, from the 1st." }],
  ["message.add", { ...n2, text: "  " }, "invalid"],
  ["message.update", { ...n2, index: 2, author: "agent-1" }],
  ["message.list", n2],
  ["message.remove", { ...n2, index: 1 }],
  ["message.remove", { ...n2, index: 5 }, "not_found"],
  ["node.update", { plan: PLAN, ref: "N3", status: "done", size: 20, description: "Première étape: it's 100 -> 101." }],
  ["node.unlock", { plan: PLAN, ref: "N2" }],
  ["node.unlock", { plan: PLAN, ref: "N9" }, "not_found"],
  ["node.show", { plan: PLAN, ref: "N2" }],
  ["node.show", { plan: PLAN, ref: "N9" }, "not_found"],
  ["node.create", plan, "invalid"],
  ["node.list", plan],
  ["node.delete", { plan: PLAN, ref: "N4" }],
  ["plan.show", plan],
  ["plan.show", { ...plan, foo: "1" }, "invalid"],
  ["plan.check", plan],
  // Half the gap: the steps are now too large, so the check must fail on both sides.
  ["plan.update", { ...plan, gapPercent: 0.5 }],
  ["plan.check", plan],
  ["plan.delete", plan],
  ["plan.show", plan, "not_found"],
]

interface Answer {
  response: OpResponse<unknown>
  /** Exit code of `rb`, or HTTP status of the API. */
  code: number
}

type Via = (op: string, input: Input) => Promise<Answer>

const cliVia =
  (extra: string[]): Via =>
  (op, input) => {
    const flags = Object.entries(input).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).flatMap((item) => [`--${kebab(key)}`, String(item)]),
    )
    const env = { ...process.env, RB_API: "" }
    return new Promise((resolve, reject) => {
      execFile(RB, [...op.split("."), ...flags, ...extra, "--json"], { maxBuffer: 16_000_000, env }, (error, stdout, stderr) => {
        try {
          resolve({ response: JSON.parse(stdout) as OpResponse<unknown>, code: error ? Number(error.code) || 1 : 0 })
        } catch {
          reject(new Error(`${toCommand(op, input)} --json did not print JSON:\n${stdout}${stderr}`))
        }
      })
    })
  }

/** `rb` on the database, and `rb --api` on the running API. */
const viaCli = cliVia([])
const viaRemoteCli = cliVia(["--api", API])

const viaApi: Via = async (op, input) => {
  const res = await fetch(`${API}/api/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return { response: (await res.json()) as OpResponse<unknown>, code: res.status }
}

const outcome = (r: OpResponse<unknown>) => (r.ok ? "ok" : r.error.code)

/** The two runs happen at different times: message timestamps are compared as present, not by value. */
const timeless = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(timeless)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, k === "at" && typeof v === "string" ? "<time>" : timeless(v)]),
        )
      : value

/** The exit code `rb` must give for this answer (see cli.ts). */
function exitFor(op: string, r: OpResponse<unknown>) {
  if (!r.ok) return 1
  return op === "plan.check" && !(r.result as CheckView).ok ? 3 : 0
}

const statusFor = (r: OpResponse<unknown>) => (r.ok ? 200 : (STATUS[r.error.code] ?? 400))

/** Removes the throwaway plan, whatever state a run left it in. */
async function reset() {
  const plans = await runOp("plan.list")
  if (plans.ok && (plans.result as PlanSummary[]).some((p) => p.slug === PLAN)) await runOp("plan.delete", plan)
}

async function play(via: Via): Promise<Answer[]> {
  await reset()
  const answers: Answer[] = []
  for (const [op, input] of STEPS) answers.push(await via(op, input))
  return answers
}

async function main(): Promise<number> {
  try {
    await fetch(`${API}/api/ops`)
  } catch {
    console.error(`The engine API does not answer on ${API}. Start it with: pnpm api`)
    return 1
  }

  let failures = 0
  const report = (problems: string[], line: string) => {
    console.log(`${problems.length ? "FAIL" : "ok  "}  ${line}`)
    for (const problem of problems) console.log(`      ${problem}`)
    if (problems.length) failures++
  }

  const cli = await play(viaCli)
  const api = await play(viaApi)
  const remote = await play(viaRemoteCli)

  STEPS.forEach(([op, input, expect = "ok"], i) => {
    const a = cli[i]!
    const b = api[i]!
    const c = remote[i]!
    const problems: string[] = []
    if (!isDeepStrictEqual(timeless(a.response), timeless(b.response))) {
      problems.push(
        "the CLI and the API answer differently:",
        `  rb:  ${JSON.stringify(a.response)}`,
        `  api: ${JSON.stringify(b.response)}`,
      )
    }
    if (!isDeepStrictEqual(timeless(c.response), timeless(b.response)) || c.code !== a.code) {
      problems.push(
        "rb --api answers differently from rb:",
        `  rb --api: ${c.code} ${JSON.stringify(c.response)}`,
      )
    }
    if (outcome(a.response) !== expect) problems.push(`rb answers ${outcome(a.response)}, expected ${expect}`)
    if (outcome(b.response) !== expect) problems.push(`the API answers ${outcome(b.response)}, expected ${expect}`)
    if (a.code !== exitFor(op, a.response)) problems.push(`rb exits with ${a.code}, expected ${exitFor(op, a.response)}`)
    if (b.code !== statusFor(b.response)) problems.push(`the API answers status ${b.code}, expected ${statusFor(b.response)}`)
    report(problems, `${toCommand(op, input)}${expect === "ok" ? "" : `  (${expect})`}`)
  })

  // The list both sides serve is the registry itself, and the scenario uses all of it.
  const registry = JSON.parse(JSON.stringify(opInfos())) as unknown
  const listed = cli[0]!.response
  report(
    listed.ok && isDeepStrictEqual(listed.result, registry) ? [] : ["rb op list does not match the registry"],
    "rb op list matches the registry",
  )
  const names = opInfos().map((info) => info.name)
  for (const name of names) {
    if (!STEPS.some(([op]) => op === name)) report(["no step of the scenario uses this operation"], toCommand(name))
  }

  console.log(
    failures
      ? `\nIsometry: ${failures} failure${failures === 1 ? "" : "s"}.`
      : `\nIsometry: ok. ${names.length} operations, ${STEPS.length} steps, same answers from rb, rb --api and the API.`,
  )
  return failures ? 1 : 0
}

main()
  .then((code) => (process.exitCode = code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => reset().finally(() => db.$disconnect()))
