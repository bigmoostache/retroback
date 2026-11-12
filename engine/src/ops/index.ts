/**
 * The registry: every operation of the engine, in one list.
 * The CLI (cli.ts) and the API (server.ts) are both built from it.
 */
import { z } from "zod"
import { kebab } from "../flags.ts"
import type { OpInfo, OpResponse } from "../types.ts"
import { defineOp, OpError, type Op } from "./define.ts"
import { itemOps } from "./items.ts"
import { messageOps } from "./messages.ts"
import { nodeOps } from "./node.ts"
import { planOps } from "./plan.ts"

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

const domainOps: Op[] = [...planOps, ...nodeOps, ...itemOps, ...messageOps]

export const ops: Op[] = [
  ...domainOps,
  defineOp({
    name: "op.list",
    summary: "List every operation with its input. The same list drives the CLI, the API and the web app.",
    mutates: false,
    input: z.strictObject({}),
    run: async () => ops.map(describe),
  }),
]

export const opInfos = () => ops.map(describe)

/** Runs an operation by name. Never throws on a caller mistake. */
export async function runOp(name: string, raw: unknown = {}): Promise<OpResponse<unknown>> {
  const op = ops.find((o) => o.name === name)
  if (!op) {
    return { ok: false, error: { code: "not_found", message: `No operation "${name}". List them with: rb op list` } }
  }
  const given = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const missing = (inputSchema(op).required ?? []).filter((key) => given[key] === undefined)
  if (missing.length) {
    const flags = missing.map((key) => `--${kebab(key)}`).join(", ")
    return { ok: false, error: { code: "invalid", message: `Missing ${flags}. Usage: ${usage(op)}` } }
  }
  try {
    return { ok: true, result: await op.run(raw) }
  } catch (error) {
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
    throw error
  }
}
