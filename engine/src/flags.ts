/**
 * How an operation and its input are written on the command line.
 * Pure, no import: the CLI parses with it and the web app prints with it, so
 * the command shown in the web app is always one the CLI accepts.
 */

export const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
export const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

const quote = (s: string) => (/^[\w.,:@%+/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/** `node.create` + `{ enables: ["N3"] }` -> `rb node create --enables N3`. */
export function toCommand(op: string, input: Record<string, unknown> = {}): string {
  const parts = ["rb", ...op.split(".")]
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      parts.push(`--${kebab(key)}`, quote(String(item)))
    }
  }
  return parts.join(" ")
}
