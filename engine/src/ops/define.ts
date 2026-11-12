import { z } from "zod"

/** An error the caller can act on. Anything else is a bug. */
export class OpError extends Error {
  code: "not_found" | "invalid" | "conflict" | "forbidden"

  constructor(message: string, code: OpError["code"] = "invalid") {
    super(message)
    this.code = code
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = z.ZodObject<any, any>

export type Input = Record<string, unknown>

/** A signed-in person. */
export interface User {
  id: string
  email: string
}

/** Who runs an operation, and through what. Kept in the event log. */
export interface Ctx {
  actor: string
  /** cli, api, seed, replay... */
  via: string
  /** The user it runs as. Null for the engine itself (maintenance scripts): no access check. */
  user: User | null
}

/**
 * One thing the engine can do. The CLI and the API are both generated from
 * the list of these, so neither can do something the other cannot.
 */
export interface Op {
  /** `<entity>.<verb>`, e.g. `node.create`. */
  name: string
  summary: string
  mutates: boolean
  input: AnyObject
  /**
   * Validates the raw input and fills in its defaults, random ones included
   * (a message id). The event log keeps this input, so replaying it gives
   * the same result.
   */
  parse: (raw: unknown, ctx: Ctx) => Input
  /** Runs on an input returned by `parse`. */
  exec: (input: Input, ctx: Ctx) => Promise<unknown>
}

export function defineOp<S extends AnyObject>(def: {
  name: string
  summary: string
  mutates: boolean
  input: S
  /** Fills in what the schema cannot: random or derived values (the author from the user). */
  prepare?: (input: z.output<S>, ctx: Ctx) => z.output<S>
  run: (input: z.output<S>, ctx: Ctx) => Promise<unknown>
}): Op {
  const prepare = def.prepare ?? ((input: z.output<S>) => input)
  return {
    name: def.name,
    summary: def.summary,
    mutates: def.mutates,
    input: def.input,
    parse: (raw, ctx) => prepare(def.input.parse(raw), ctx) as Input,
    exec: (input, ctx) => def.run(input as z.output<S>, ctx),
  }
}

/** Shared by every operation that targets a plan. */
export const planFlag = z
  .string()
  .optional()
  .describe("Plan slug. Default: RB_PLAN with rb, otherwise the only plan you can see.")
