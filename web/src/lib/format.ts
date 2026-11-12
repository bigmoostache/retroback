import type { Gap } from "@engine/types.ts"

/** Same spelling of numbers and gaps as the CLI (engine/src/cli.ts). */
export const num = (n: number) => String(Number(n.toPrecision(12)))

export const gapText = (gap: Gap) =>
  gap.percent === null ? "n/a" : `${gap.percent > 0 ? "+" : ""}${gap.percent}%`

/** A node's level, or "milestone" for a node that moves no metric. */
export const levelText = (level: number | null) => (level === null ? "milestone" : num(level))

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
/** A YYYY-MM-DD day, short: "12 Nov". */
export const dayText = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`))
