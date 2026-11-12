/**
 * Checks that the CLI and the API do the same thing: `pnpm check:isometry`
 * (the API must be running: `pnpm api`).
 *
 * It plays one scenario twice on a throwaway plan, once through `rb --json`
 * and once through POST /api/<op>, and compares the answers step by step.
 * Both sides sign in with API keys of two test users: the owner of the plan,
 * and a stranger who is given access, then leaves. The scenario must use
 * every operation of the registry, so adding an operation without a step
 * here fails the check.
 */
import { execFile } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { stringify as stringifyYaml } from "yaml"
import { hashSecret, newSecret, userByEmail } from "./access.ts"
import { db } from "./db.ts"
import { API_PORT, DEV } from "./env.ts"
import { kebab, toCommand } from "./flags.ts"
import { ENGINE, opInfos, runOp } from "./ops/index.ts"
import type { CheckView, OpResponse, PlanSummary } from "./types.ts"

const PLAN = "isometry-check"
const REPLAY = "isometry-replay"
const API = `http://127.0.0.1:${API_PORT}`
const RB = path.resolve(import.meta.dirname, "../../bin/rb")
const OWNER = "isometry-owner@test"
const STRANGER = "isometry-stranger@test"
/** The keys the check signs in with; every other key of the test users is removed between runs. */
const KEY_NAME = "isometry"
/** HTTP status of each error code (see server.ts). */
const STATUS: Record<string, number> = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409 }

type Input = Record<string, unknown>
type Outcome = "ok" | "invalid" | "not_found" | "conflict" | "forbidden" | "unauthorized"
/** Who runs a step: the owner of the plan (default), the stranger, or nobody (no key). */
type Who = "owner" | "stranger" | "nobody"
/** An operation, its input, how it must end ("ok" when omitted), and who runs it. */
type Step = [op: string, input: Input, expect?: Outcome, who?: Who]

const plan = { plan: PLAN }
const n2 = { plan: PLAN, node: "N2" }

const STEPS: Step[] = [
  ["op.list", {}],
  // Without a key: refused, except with DEV=true, where it is local@dev.
  ["plan.list", {}, DEV ? "ok" : "unauthorized", "nobody"],
  [
    "plan.create",
    { slug: PLAN, title: "Isometry check", target: "Reach 103.", metric: "score", unit: "points", presentValue: 100, targetValue: 103 },
  ],
  ["plan.list", {}],
  ["user.me", {}],
  // A plan is invisible to those it is not shared with.
  ["plan.show", plan, "not_found", "stranger"],
  ["node.create", { ...plan, title: "Target", criterion: ["Score is 103 for 2 weeks."] }],
  ["node.create", { ...plan, title: "Step before", description: "What the target requires.", enables: ["N1"], size: 70 }],
  ["node.create", { ...plan, title: "First step", enables: ["N2"], level: 101 }],
  ["node.create", { ...plan, title: "Side step", level: 100.5 }],
  ["node.create", { ...plan, title: "Bad size", level: 100.2, size: 101 }, "invalid"],
  ["requirement.add", { ...n2, text: "Side work done.", providedBy: "N4" }],
  ["requirement.add", { ...n2, text: "Again.", providedBy: "N4", slug: "side-work-done" }, "conflict"],
  ["requirement.add", { ...n2, text: "No provider." }, "invalid"],
  ["requirement.add", { plan: PLAN, node: "N1", text: "Itself.", providedBy: "N1" }, "conflict"],
  // N2 requires N4, so N4 cannot require N2: that would close a loop.
  ["requirement.add", { plan: PLAN, node: "N4", text: "Loop.", providedBy: "N2" }, "conflict"],
  ["requirement.update", { plan: PLAN, node: "N4", requirement: "loop", text: "x" }, "not_found"],
  ["node.unlock", { plan: PLAN, ref: "N1" }],
  ["requirement.update", { ...n2, requirement: "side-work-done", providedBy: "N3", slug: "side-work" }],
  ["requirement.update", { ...n2, requirement: "side-work-done", text: "x" }, "not_found"],
  ["requirement.update", { ...n2, requirement: "side-work", slug: "first-step" }, "conflict"],
  ["requirement.remove", { ...n2, requirement: "side-work" }],
  ["requirement.remove", { ...n2, requirement: "side-work" }, "not_found"],
  ["criterion.add", { ...n2, text: "Score is 102 for 2 weeks." }],
  ["criterion.add", { ...n2, text: "To remove.", slug: "drop" }],
  ["criterion.update", { ...n2, criterion: "score-is-102-for-2-weeks", met: true }],
  ["criterion.update", { ...n2, criterion: "drop", slug: "score-is-102-for-2-weeks" }, "conflict"],
  ["criterion.remove", { ...n2, criterion: "drop" }],
  ["criterion.remove", { ...n2, criterion: "drop" }, "not_found"],
  ["resource.add", { ...n2, kind: "human", name: "analyst", quantity: 2.5, unit: "person-days" }],
  ["resource.add", { ...n2, kind: "capital", name: "licence", quantity: 300, unit: "EUR" }],
  ["resource.update", { ...n2, resource: "analyst", quantity: 3 }],
  ["resource.remove", { ...n2, resource: "licence" }],
  // A batch: all or nothing, later steps use the nodes created by earlier ones ($name).
  [
    "batch.apply",
    {
      ...plan,
      steps: [
        { op: "node.create", as: "funding", title: "Funding closed", milestone: true, enables: ["N3"], duration: 10, due: "2099-01-01" },
        { op: "obstacle.add", node: "$funding", text: "Bank delays the transfer.", fix: "Bridge loan ready." },
        { op: "resource.add", node: "$funding", kind: "capital", name: "seed", quantity: 500, unit: "EUR", provides: true },
        { op: "node.create", as: "pitch", title: "Pitch deck", enables: ["$funding"], level: 100.2, duration: 3 },
      ],
    },
  ],
  // The second step fails, so the first is undone: N7 must not exist.
  [
    "batch.apply",
    { ...plan, steps: [{ op: "node.create", title: "Rolled back", level: 100.1 }, { op: "obstacle.add", node: "N99", text: "x" }] },
    "not_found",
  ],
  ["node.show", { plan: PLAN, ref: "N7" }, "not_found"],
  ["batch.apply", { ...plan, steps: [{ op: "node.create", as: "x", title: "Undone" }, { op: "node.show", ref: "$y" }] }, "invalid"],
  ["node.create", { ...plan, title: "Both", milestone: true, level: 101 }, "invalid"],
  ["obstacle.list", { plan: PLAN, node: "N5" }],
  ["obstacle.add", { plan: PLAN, node: "N5", text: "Lead investor walks away.", slug: "lead" }],
  ["obstacle.add", { plan: PLAN, node: "N5", text: "Again.", slug: "lead" }, "conflict"],
  ["obstacle.update", { plan: PLAN, node: "N5", obstacle: "bank-delays-the-transfer", status: "fixed" }],
  ["obstacle.remove", { plan: PLAN, node: "N5", obstacle: "lead" }],
  ["obstacle.remove", { plan: PLAN, node: "N5", obstacle: "lead" }, "not_found"],
  ["node.update", { plan: PLAN, ref: "N6", due: "2099-06-01", size: 10 }],
  ["node.update", { plan: PLAN, ref: "N6", due: "2099-06-01", noDue: true }, "invalid"],
  // A provider beyond the node it provides for is refused.
  ["requirement.add", { plan: PLAN, node: "N4", text: "Backward.", providedBy: "N2" }, "conflict"],
  ["node.tree", { plan: PLAN, ref: "N1", depth: 4 }],
  ["node.tree", { plan: PLAN, ref: "N1", depth: 9 }, "invalid"],
  ["node.list", { ...plan, ready: true }],
  ["plan.update", { ...plan, start: "2099-01-01", cash: 100, cashUnit: "EUR" }],
  ["plan.update", { ...plan, start: "2099-01-01", noStart: true }, "invalid"],
  ["plan.update", { ...plan, noStart: true }],
  // Sharing: the owner gives access, the contributor works, may not delete or share, then leaves.
  ["plan.share", { ...plan, email: STRANGER }],
  ["plan.share", { ...plan, email: STRANGER }, "conflict"],
  ["plan.members", plan],
  ["message.add", { ...n2, text: "Who owns the data access?", author: "guillaume", id: "m-owner" }],
  // No --author: the message is signed with the email of the key's user.
  ["message.add", { ...n2, text: "Ops lead, from the 1st.", id: "m-answer" }, "ok", "stranger"],
  ["message.add", { ...n2, text: "Twice.", id: "m-answer" }, "conflict"],
  ["message.add", { ...n2, text: "  " }, "invalid"],
  ["message.update", { ...n2, message: "m-answer", author: "agent-1" }],
  ["message.list", n2, "ok", "stranger"],
  ["message.list", { ...n2, last: 1 }],
  ["criterion.list", n2],
  ["requirement.list", { plan: PLAN, node: "N1" }],
  ["resource.list", n2],
  ["resource.list", plan],
  ["resource.list", { plan: PLAN, node: "N9" }, "not_found"],
  ["node.list", { ...plan, limit: 2 }],
  ["node.list", { ...plan, after: "N2", limit: 1 }],
  ["node.list", { ...plan, status: "done" }],
  ["node.list", { ...plan, after: "N9" }, "not_found"],
  ["node.list", { ...plan, limit: 0 }, "invalid"],
  ["plan.show", { ...plan, limit: 1 }],
  ["plan.show", { ...plan, full: true }],
  ["message.remove", { ...n2, message: "m-owner" }],
  ["message.remove", { ...n2, message: "m-nope" }, "not_found"],
  ["plan.delete", plan, "forbidden", "stranger"],
  ["plan.share", { ...plan, email: "someone@test" }, "forbidden", "stranger"],
  ["plan.unshare", { ...plan, email: OWNER }, "conflict"],
  ["plan.unshare", { ...plan, email: STRANGER }, "ok", "stranger"],
  ["plan.unshare", { ...plan, email: STRANGER }, "not_found"],
  ["node.show", { plan: PLAN, ref: "N2" }, "not_found", "stranger"],
  // A new node that takes over the requirement N2 provided to N1.
  ["node.create", { ...plan, title: "Other way", enables: ["N1"], forRequirement: "step-before" }],
  ["node.create", { ...plan, title: "Nope", enables: ["N1"], forRequirement: "missing" }, "not_found"],
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
  // API keys of the signed-in user.
  ["key.create", { name: "temp" }],
  ["key.create", { name: "temp" }, "conflict"],
  ["key.list", {}],
  ["key.revoke", { name: "temp" }],
  ["key.revoke", { name: "temp" }, "not_found"],
  // The log of this run, then the plan rebuilt from it as it is now.
  ["event.list", { ...plan, last: 3 }],
  ["event.list", plan, "not_found", "stranger"],
  ["event.replay", { ...plan, as: REPLAY }],
  ["event.replay", { ...plan, as: REPLAY }, "conflict"],
  ["event.replay", { plan: "never-existed", as: "nope" }, "not_found"],
  ["plan.delete", { plan: REPLAY }],
  ["plan.delete", plan],
  ["plan.show", plan, "not_found"],
]

interface Answer {
  response: OpResponse<unknown>
  /** Exit code of `rb`, or HTTP status of the API. */
  code: number
}

type Keys = Record<Who, string | undefined>
type Via = (op: string, input: Input, key: string | undefined) => Promise<Answer>

/** `rb --api <API> --key <key> ... --json`. A batch goes through `rb apply <file>`, as agents use it. */
const viaCli: Via = (op, input, key) => {
  let words: string[]
  if (op === "batch.apply") {
    const { steps, ...rest } = input
    const file = path.join(mkdtempSync(path.join(tmpdir(), "rb-iso-")), "steps.yaml")
    writeFileSync(file, stringifyYaml(steps))
    words = ["apply", file, ...Object.entries(rest).flatMap(([k, v]) => [`--${kebab(k)}`, String(v)])]
  } else {
    const flags = Object.entries(input).flatMap(([k, value]) =>
      (Array.isArray(value) ? value : [value]).flatMap((item) => [`--${kebab(k)}`, String(item)]),
    )
    words = [...op.split("."), ...flags]
  }
  const env = { ...process.env, RB_API: "", RB_KEY: "", RB_PLAN: "" }
  const args = [...words, "--api", API, ...(key ? ["--key", key] : []), "--json"]
  return new Promise((resolve, reject) => {
    execFile(RB, args, { maxBuffer: 16_000_000, env }, (error, stdout, stderr) => {
      try {
        resolve({ response: JSON.parse(stdout) as OpResponse<unknown>, code: error ? Number(error.code) || 1 : 0 })
      } catch {
        reject(new Error(`${toCommand(op, input)} --json did not print JSON:\n${stdout}${stderr}`))
      }
    })
  })
}

const viaApi: Via = async (op, input, key) => {
  const res = await fetch(`${API}/api/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(input),
  })
  return { response: (await res.json()) as OpResponse<unknown>, code: res.status }
}

const outcome = (r: OpResponse<unknown>) => (r.ok ? "ok" : r.error.code)

/**
 * The runs happen at different times and through different entry points:
 * timestamps, log sequence numbers, who/through what and key secrets are
 * compared as present, not by value.
 */
const VARYING = new Set(["at", "seq", "upTo", "actor", "via", "secret", "prefix", "createdAt", "lastUsedAt"])
const timeless = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(timeless)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            VARYING.has(k) && (typeof v === "string" || typeof v === "number") ? `<${k}>` : timeless(v),
          ]),
        )
      : value

/** The exit code `rb` must give for this answer (see cli.ts). */
function exitFor(op: string, r: OpResponse<unknown>) {
  if (!r.ok) return 1
  return op === "plan.check" && !(r.result as CheckView).ok ? 3 : 0
}

const statusFor = (r: OpResponse<unknown>) => (r.ok ? 200 : (STATUS[r.error.code] ?? 400))

/** Removes the throwaway plans and the extra keys of the test users, whatever state a run left them in. */
async function reset() {
  const plans = await runOp("plan.list", {}, ENGINE)
  if (plans.ok) {
    for (const slug of [PLAN, REPLAY]) {
      if ((plans.result as PlanSummary[]).some((p) => p.slug === slug)) await runOp("plan.delete", { plan: slug }, ENGINE)
    }
  }
  await db.apiKey.deleteMany({ where: { user: { email: { in: [OWNER, STRANGER] } }, name: { not: KEY_NAME } } })
}

/** A fresh key for each test user, written straight to the database. */
async function keysFor(): Promise<Keys> {
  const key = async (email: string) => {
    const user = await userByEmail(email, email.split("@")[0])
    await db.apiKey.deleteMany({ where: { userId: user.id } })
    const secret = newSecret("rb_")
    await db.apiKey.create({ data: { userId: user.id, name: KEY_NAME, prefix: secret.slice(0, 7), hash: hashSecret(secret) } })
    return secret
  }
  return { owner: await key(OWNER), stranger: await key(STRANGER), nobody: undefined }
}

async function play(via: Via, keys: Keys): Promise<Answer[]> {
  await reset()
  const answers: Answer[] = []
  for (const [op, input, , who = "owner"] of STEPS) answers.push(await via(op, input, keys[who]))
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

  const keys = await keysFor()
  const cli = await play(viaCli, keys)
  const api = await play(viaApi, keys)

  STEPS.forEach(([op, input, expect = "ok", who = "owner"], i) => {
    const a = cli[i]!
    const b = api[i]!
    const problems: string[] = []
    if (!isDeepStrictEqual(timeless(a.response), timeless(b.response))) {
      problems.push(
        "the CLI and the API answer differently:",
        `  rb:  ${JSON.stringify(a.response)}`,
        `  api: ${JSON.stringify(b.response)}`,
      )
    }
    if (outcome(a.response) !== expect) problems.push(`rb answers ${outcome(a.response)}, expected ${expect}`)
    if (outcome(b.response) !== expect) problems.push(`the API answers ${outcome(b.response)}, expected ${expect}`)
    if (a.code !== exitFor(op, a.response)) problems.push(`rb exits with ${a.code}, expected ${exitFor(op, a.response)}`)
    if (b.code !== statusFor(b.response)) problems.push(`the API answers status ${b.code}, expected ${statusFor(b.response)}`)
    const as = who === "owner" ? "" : `  [as ${who}]`
    report(problems, `${toCommand(op, input)}${expect === "ok" ? "" : `  (${expect})`}${as}`)
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
      : `\nIsometry: ok. ${names.length} operations, ${STEPS.length} steps, same answers from rb and the API.`,
  )
  return failures ? 1 : 0
}

main()
  .then((code) => (process.exitCode = code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() =>
    reset()
      .then(() => db.apiKey.deleteMany({ where: { user: { email: { in: [OWNER, STRANGER] } } } }))
      .finally(() => db.$disconnect()),
  )
