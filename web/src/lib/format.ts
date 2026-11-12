import type { Gap } from "@engine/types.ts"

/** Same spelling of numbers and gaps as the CLI (engine/src/cli.ts). */
export const num = (n: number) => String(Number(n.toPrecision(12)))

export const gapText = (gap: Gap) =>
  gap.percent === null ? "n/a" : `${gap.percent > 0 ? "+" : ""}${gap.percent}%`

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
