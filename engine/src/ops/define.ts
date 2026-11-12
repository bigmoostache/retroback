import { z } from "zod"

/** An error the caller can act on. Anything else is a bug. */
export class OpError extends Error {
  code: "not_found" | "invalid" | "conflict"

  constructor(message: string, code: OpError["code"] = "invalid") {
    super(message)
    this.code = code
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = z.ZodObject<any, any>

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
  /** Validates the raw input, then runs. */
  run: (raw: unknown) => Promise<unknown>
}

export function defineOp<S extends AnyObject>(def: {
  name: string
  summary: string
  mutates: boolean
  input: S
  run: (input: z.output<S>) => Promise<unknown>
}): Op {
  return { ...def, run: (raw) => def.run(def.input.parse(raw)) }
}

/** Shared by every operation that targets a plan. */
export const planFlag = z.string().optional().describe("Plan slug. Optional when there is only one plan.")
