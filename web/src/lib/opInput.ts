/**
 * From a form to the input of an operation.
 * The fields come from the operation's JSON Schema, the one `rb` reads its
 * flags from, so a form can send exactly what the CLI can.
 */
import { kebab } from "@engine/flags.ts"
import type { OpInfo } from "@engine/types.ts"
import type { Input } from "@/lib/api"

/** Field values as typed. A list is one item per line, a boolean is "true" or "false". */
export type Values = Record<string, string>

export interface FormSetup {
  /** Context of the action (plan, node, index): always sent, not shown as fields. */
  fixed: Input
  /** Values the fields start with. */
  initial: Input
  /** Send only the fields that differ from `initial` (update operations). */
  changesOnly: boolean
}

export const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : Array.isArray(value) ? value.join("\n") : String(value)

/** The fields to show: every input of the operation that the context does not fix. */
export const fieldsOf = (info: OpInfo, fixed: Input) =>
  Object.entries(info.input.properties ?? {}).filter(([key]) => !(key in fixed))

export const startValues = (info: OpInfo, setup: FormSetup): Values =>
  Object.fromEntries(fieldsOf(info, setup.fixed).map(([key]) => [key, asText(setup.initial[key])]))

export function toInput(info: OpInfo, values: Values, setup: FormSetup): { input: Input; error: string | null } {
  const input: Input = {}
  let error: string | null = null
  for (const [key, prop] of Object.entries(info.input.properties ?? {})) {
    if (key in setup.fixed) {
      input[key] = setup.fixed[key]
      continue
    }
    const text = values[key] ?? ""
    if (setup.changesOnly && text === asText(setup.initial[key])) continue
    if (text === "") {
      // A text that was filled and is now empty is sent empty; other types cannot be unset.
      if (setup.changesOnly && prop.type === "string") input[key] = ""
      continue
    }
    if (prop.type === "number" || prop.type === "integer") {
      const value = Number(text)
      if (text.trim() === "" || !Number.isFinite(value)) {
        error ??= `--${kebab(key)} must be a number, got "${text}".`
      } else input[key] = value
    } else if (prop.type === "boolean") {
      input[key] = text === "true"
    } else if (prop.type === "array") {
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length) input[key] = lines
    } else {
      input[key] = text
    }
  }
  return { input, error }
}
