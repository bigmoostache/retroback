import { toCommand } from "@engine/flags.ts"
import type { OpResponse } from "@engine/types.ts"

/** The input of an operation: what the CLI gets as flags. */
export type Input = Record<string, unknown>

export { toCommand }

/**
 * Runs an operation of the engine. Same call and same answer as
 * `rb <entity> <verb> --json`.
 */
export async function call<T = unknown>(op: string, input: Input = {}): Promise<OpResponse<T>> {
  try {
    const res = await fetch(`/api/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    return (await res.json()) as OpResponse<T>
  } catch {
    return {
      ok: false,
      error: { code: "unreachable", message: "The engine API does not answer. Start it with: pnpm api" },
    }
  }
}
