/** One line of a node, for lists. Pure, no import: the CLI and the web app use it too. */
import type { NodeSummary, NodeView } from "./types.ts"

const tally = (items: { met: boolean }[]) => ({ total: items.length, met: items.filter((i) => i.met).length })

export const summariseNode = (n: NodeView): NodeSummary => ({
  plan: n.plan,
  ref: n.ref,
  seq: n.seq,
  title: n.title,
  level: n.level,
  status: n.status,
  size: n.size,
  gap: n.gap,
  dependsOn: n.dependsOn,
  enables: n.enables,
  criteria: tally(n.criteria),
  requirements: tally(n.requirements),
  resources: n.resources.length,
  messages: n.messages.length,
})
