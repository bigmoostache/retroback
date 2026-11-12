/**
 * The registry: every operation of the engine, in one list.
 * The CLI (cli.ts) and the API (server.ts) are both built from it.
 *
 * Every operation that changes data is written to the event log (events.ts),
 * whether it succeeds or not: who asked, when, through what, with what input.
 */
import { z } from "zod"
import { withCtx } from "../access.ts"
import { db } from "../db.ts"
import { kebab } from "../flags.ts"
import type { OpInfo, OpResponse } from "../types.ts"
import { defineOp, OpError, type Ctx, type Input, type Op } from "./define.ts"
import { eventOps } from "./events.ts"
import { itemOps } from "./items.ts"
import { messageOps } from "./messages.ts"
import { nodeOps } from "./node.ts"
import { peopleOps } from "./people.ts"
import { planOps } from "./plan.ts"

export type { Ctx }

/** The engine itself (maintenance scripts): no user, no access check. */
export const ENGINE: Ctx = { actor: "engine", via: "engine", user: null }

const inputSchema = (op: Op) => z.toJSONSchema(op.input, { io: "input" }) as OpInfo["input"]

function usage(op: Op): string {
  const schema = inputSchema(op)
  const required = new Set(schema.required ?? [])
  const flags = Object.entries(schema.properties ?? {}).map(([key, prop]) => {
    const flag = `--${kebab(key)} <${prop.enum ? prop.enum.join("|") : prop.type === "array" ? "text" : (prop.type ?? "text")}>`
    if (prop.type === "array") return `[${flag}]...`
    return required.has(key) ? flag : `[${flag}]`
  })
  return ["rb", ...op.name.split("."), ...flags].join(" ")
}

const describe = (op: Op): OpInfo => ({
  name: op.name,
  summary: op.summary,
  mutates: op.mutates,
  input: inputSchema(op),
  cli: usage(op),
})

const domainOps: Op[] = [...planOps, ...nodeOps, ...itemOps, ...messageOps, ...peopleOps]

export const ops: Op[] = [
  ...domainOps,
  ...eventOps((name, input, ctx) => runOp(name, input, ctx)),
  defineOp({
    name: "op.list",
    summary: "List every operation with its input. The same list drives the CLI, the API and the web app.",
    mutates: false,
    input: z.strictObject({}),
    run: async () => ops.map(describe),
  }),
]

export const opInfos = () => ops.map(describe)

const text = (value: unknown) => (typeof value === "string" && value ? value : null)

/** The plan an operation touched: the one it was given, or the one its answer names. */
function planTouched(input: Input, result: unknown): string | null {
  const given = text(input["plan"])
  if (given) return given
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>
    return text(r["plan"]) ?? text(r["slug"])
  }
  return null
}

async function record(op: Op, input: Input, ctx: Ctx, response: OpResponse<unknown>) {
  const result = response.ok ? response.result : undefined
  const plan = planTouched(input, result)
  await db.event.create({
    data: {
      actor: ctx.actor,
      via: ctx.via,
      op: op.name,
      plan,
      // The plan is written down even when the caller let it be guessed, so a replay never has to guess.
      input: JSON.parse(JSON.stringify(plan && !("plan" in input) && op.name !== "plan.create" ? { ...input, plan } : input)),
      ok: response.ok,
      error: response.ok ? null : `${response.error.code}: ${response.error.message}`,
    },
  })
}

function explain(error: unknown, op: Op): OpResponse<never> | null {
  if (error instanceof OpError) return { ok: false, error: { code: error.code, message: error.message } }
  if (error instanceof z.ZodError) {
    const message = error.issues
      .map((issue) => {
        const key = issue.path[0]
        const unknown = issue.code === "unrecognized_keys" ? issue.keys.map((k) => `--${kebab(k)}`).join(", ") : ""
        // Same wording as the CLI's own flag parser (cli.ts).
        if (unknown) return `Unknown flag ${unknown}`
        return typeof key === "string" ? `--${kebab(key)}: ${issue.message}` : issue.message
      })
      .join("; ")
    return { ok: false, error: { code: "invalid", message: `${message}. Usage: ${usage(op)}` } }
  }
  return null
}

/** Runs an operation by name. Never throws on a caller mistake. */
export async function runOp(name: string, raw: unknown = {}, ctx: Ctx = ENGINE): Promise<OpResponse<unknown>> {
  const op = ops.find((o) => o.name === name)
  if (!op) {
    return { ok: false, error: { code: "not_found", message: `No operation "${name}". List them with: rb op list` } }
  }
  const given = raw && typeof raw === "object" ? (raw as Input) : {}
  let input: Input = given
  let response: OpResponse<unknown>
  const missing = (inputSchema(op).required ?? []).filter((key) => given[key] === undefined)
  if (missing.length) {
    const flags = missing.map((key) => `--${kebab(key)}`).join(", ")
    response = { ok: false, error: { code: "invalid", message: `Missing ${flags}. Usage: ${usage(op)}` } }
  } else {
    try {
      input = op.parse(raw, ctx)
      const parsed = input
      // Access checks (access.ts) read the user from this context.
      response = { ok: true, result: await withCtx(ctx, () => op.exec(parsed, ctx)) }
    } catch (error) {
      const known = explain(error, op)
      if (!known) throw error
      response = known
    }
  }
  if (op.mutates) await record(op, input, ctx, response)
  return response
}
