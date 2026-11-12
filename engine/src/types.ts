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
  /** True when the node brings this in once done (a funding round brings capital) instead of using it. */
  provides: boolean
}

export type ObstacleStatus = "open" | "fixed"

/** What could stop a node, and how it is handled. */
export interface ObstacleView {
  slug: string
  text: string
  /** How it is solved or worked around. Empty when not known yet. */
  fix: string
  status: ObstacleStatus
}

/** When a node can start and finish at the earliest, as ISO dates (YYYY-MM-DD). */
export interface Schedule {
  /** Once every node it requires is finished, and not before the plan starts. Null when a duration before it is unknown. */
  start: string | null
  /** Start plus duration. Null when unknown. */
  finish: string | null
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
  /** Metric value reached once the node is done. Null for a milestone: a step that moves no metric. */
  level: number | null
  status: NodeStatus
  /** How big the node is, from 0 (tiny) to 100 (largest). */
  size: number
  /** How long the work takes, in days. Null: unknown. */
  duration: number | null
  /** Date it must be done by (YYYY-MM-DD). Null: none. */
  due: string | null
  schedule: Schedule
  /** Not done, every node it requires is done, and its start date is reached. */
  ready: boolean
  criteria: CheckItem[]
  requirements: RequirementView[]
  resources: ResourceView[]
  obstacles: ObstacleView[]
  /** Former nodes this one requires: the providers of its requirements. */
  dependsOn: string[]
  /** Later nodes whose requirements this one provides. */
  enables: string[]
  /** Null for a milestone. */
  gap: Gap | null
  /** Oldest first. */
  messages: MessageView[]
}

/** How many of a node's items there are, and how many are met. */
export interface Tally {
  total: number
  met: number
}

/** One line of a node: what lists show. `rb node show` gives the whole node. */
export interface NodeSummary {
  plan: string
  ref: string
  seq: number
  title: string
  level: number | null
  status: NodeStatus
  size: number
  gap: Gap | null
  schedule: Schedule
  due: string | null
  ready: boolean
  dependsOn: string[]
  enables: string[]
  criteria: Tally
  requirements: Tally
  resources: number
  /** Open obstacles / all of them. */
  obstacles: { total: number; open: number }
  messages: number
}

/** A page of nodes, in ref order. */
export interface NodePage {
  plan: string
  /** How many nodes match the filters, on every page. */
  total: number
  nodes: NodeSummary[]
  /** Ref to pass to --after for the next page; null on the last page. */
  next: string | null
}

/** What `plan show` answers without --full: the plan, its check counts and a first page of nodes. */
export interface PlanBrief extends PlanSummary {
  check: { ok: boolean; errors: number; warnings: number }
  nodes: NodePage
}

/** What `resource list` answers without --node: the resources summed over the plan. */
export interface ResourceTotals {
  plan: string
  resources: ResourceTotal[]
}

/** What `message list` answers: the latest messages, oldest first. */
export interface MessagePage {
  plan: string
  node: string
  total: number
  messages: MessageView[]
}

/** What `criterion list`, `requirement list` and `resource list --node` answer. */
export interface ItemList<T> {
  plan: string
  node: string
  items: T[]
}

/** One node of `node tree`, with what it requires down to the asked depth. */
export interface TreeNode extends NodeSummary {
  /** Nodes it requires, one level deeper. Empty at the last level; `cut` tells whether more exist. */
  requires: TreeNode[]
  /** True when it requires more nodes than shown (depth or size limit reached). */
  cut: boolean
}

/** What `node tree` answers. */
export interface TreeView {
  plan: string
  root: TreeNode
  depth: number
  /** How many nodes are shown; a node reached twice is shown once in full, then as a bare line. */
  shown: number
}

/** What `sql.query` answers: `rb sql` prints it as CSV. */
export interface SqlView {
  plan: string
  columns: string[]
  rows: (string | number | null)[][]
  /** True when more rows matched than were returned. */
  cut: boolean
}

/** What `node unlock` answers. */
export interface UnlockView {
  /** The node to reach. */
  target: string
  /** What to tackle now: open nodes whose requirements are all done. */
  nodes: NodeSummary[]
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

export type PlanRole = "owner" | "contributor"

/** What `user.me` answers. */
export interface UserView {
  email: string
  name: string
  plans: { plan: string; role: PlanRole }[]
}

/** A person with access to a plan. */
export interface MemberView {
  email: string
  name: string
  role: PlanRole
}

/** An API key, without its secret. `key.create` adds `secret`, once. */
export interface ApiKeyView {
  name: string
  /** The first characters of the secret, e.g. rb_Ab3d. */
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
  secret?: string
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
  plan: PlanBrief | null
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
