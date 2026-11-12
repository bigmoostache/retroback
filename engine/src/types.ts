/**
 * Shapes returned by the operations.
 * Pure types with no import: the web app reads this file too.
 */

export type NodeStatus = "todo" | "doing" | "done"

/** The step between a node and what it starts from. */
export interface Gap {
  /** What the node is measured against: a node ref, or "present". */
  from: string
  base: number
  /** Progress beyond `base`, in percent. Null when `base` is 0. */
  percent: number | null
  /** True when the step is positive and within the plan's limit. */
  ok: boolean
}

export interface CheckItem {
  /** Handle of the item, unique in its node. */
  slug: string
  text: string
  met: boolean
}

export interface RequirementView extends CheckItem {
  /** The former node that provides it. `met` is true once it is done. */
  providedBy: string
}

export interface ResourceView {
  slug: string
  kind: string
  name: string
  quantity: number
  unit: string
}

export interface MessageView {
  /** Handle of the message, e.g. m-7f3a2c. */
  id: string
  author: string
  text: string
  /** When it was written, ISO 8601. */
  at: string
  /** True once the text was changed after it was written. */
  edited: boolean
}

export interface NodeView {
  plan: string
  ref: string
  seq: number
  title: string
  description: string
  /** Metric value reached once the node is done. */
  level: number
  status: NodeStatus
  /** How big the node is, from 0 (tiny) to 100 (largest). */
  size: number
  criteria: CheckItem[]
  requirements: RequirementView[]
  resources: ResourceView[]
  /** Former nodes this one requires: the providers of its requirements. */
  dependsOn: string[]
  /** Later nodes whose requirements this one provides. */
  enables: string[]
  gap: Gap
  /** Oldest first. */
  messages: MessageView[]
}

/** What `node unlock` answers. */
export interface UnlockView {
  /** The node to reach. */
  target: string
  /** What to tackle now: open nodes whose requirements are all done. */
  nodes: NodeView[]
  /** Heaviest path of sizes through the open nodes up to `target`: what is left with perfect parallelism. */
  size: number
}

export interface Issue {
  severity: "error" | "warning"
  code: string
  node: string | null
  message: string
}

export interface CheckView {
  plan: string
  /** True when there is no error. Warnings do not fail the check. */
  ok: boolean
  issues: Issue[]
}

export interface ResourceTotal {
  kind: string
  name: string
  unit: string
  quantity: number
  nodes: string[]
}

export interface PlanSummary {
  slug: string
  title: string
  target: string
  metric: string
  unit: string
  presentValue: number
  targetValue: number
  gapPercent: number
  nodeCount: number
}

export interface PlanView extends PlanSummary {
  /** From the target (N1) back to the present. */
  nodes: NodeView[]
  resources: ResourceTotal[]
  check: CheckView
}

/** One entry of the event log. */
export interface EventView {
  seq: number
  /** ISO 8601. */
  at: string
  actor: string
  /** cli, api, seed, replay... */
  via: string
  op: string
  plan: string | null
  input: Record<string, unknown>
  ok: boolean
  error: string | null
}

/** What `event replay` answers. */
export interface ReplayView {
  from: string
  as: string
  replayed: number
  /** Last sequence number replayed. */
  upTo: number
  /** The rebuilt plan; null when the history ends with its deletion. */
  plan: PlanView | null
}

export interface OpInfo {
  name: string
  summary: string
  mutates: boolean
  /** JSON Schema of the input. */
  input: {
    properties?: Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown }>
    required?: string[]
  }
  /** How to call it from the CLI. */
  cli: string
}

export type OpResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string } }
