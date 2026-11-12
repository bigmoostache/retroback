/**
 * Slugs: how plans, criteria, requirements and resources are addressed.
 * Pure, no import. Nothing in Retroback is addressed by its position.
 */

/** `Line 2 packs 45 parcels!` -> `line-2-packs-45-parcels`. Same rule as the SQL migration. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "")

/** `base`, or `base-2`, `base-3`... the first one not taken. */
export function uniqueSlug(text: string, taken: Iterable<string>): string {
  const base = slugify(text) || "item"
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

/** A short random handle for a message: `m-` and 6 hex digits. */
export const messageHandle = () =>
  `m-${Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("")}`
