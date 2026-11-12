/**
 * The actions of the plan screen. Each one is an operation of the engine with
 * what the screen already knows filled in; the dialog shows its `rb` command.
 * Items are addressed by slug, messages by id: never by position.
 */
import type {
  CheckItem,
  MessageView,
  NodeView,
  ObstacleView,
  PlanSummary,
  RequirementView,
  ResourceView,
} from "@engine/types.ts"
import type { Input } from "@/lib/api"

export interface OpRequest {
  /** Operation name, e.g. `node.create`. */
  op: string
  title: string
  description?: string | undefined
  /** Context of the action (plan, node, slug): always sent, not shown as fields. */
  fixed?: Input | undefined
  /** Values the fields start with. */
  initial?: Input | undefined
  /** Send only the fields that changed (update operations). */
  changesOnly?: boolean | undefined
  submitLabel?: string | undefined
  destructive?: boolean | undefined
  onDone?: Done | undefined
}

export type Ask = (request: OpRequest) => void
type Done = (result: unknown) => void

export type ListEntity = "criterion" | "requirement"
const WHAT: Record<ListEntity, string> = { criterion: "success criterion", requirement: "requirement" }

const at = (node: NodeView) => ({ plan: node.plan, node: node.ref })

export const planCreate = (): OpRequest => ({
  op: "plan.create",
  title: "New plan",
  description: "One metric, its value today and the value aimed at. Nodes are then created from the target backward.",
  submitLabel: "Create",
})

export const planUpdate = (plan: PlanSummary): OpRequest => ({
  op: "plan.update",
  title: "Edit the plan",
  fixed: { plan: plan.slug },
  initial: {
    title: plan.title,
    target: plan.target,
    metric: plan.metric,
    unit: plan.unit,
    presentValue: plan.presentValue,
    targetValue: plan.targetValue,
    gapPercent: plan.gapPercent,
  },
  changesOnly: true,
  submitLabel: "Save",
})

export const planDelete = (plan: PlanSummary): OpRequest => ({
  op: "plan.delete",
  title: `Delete the plan "${plan.title}"?`,
  description: `Its nodes (${plan.nodeCount}) are deleted with it.`,
  fixed: { plan: plan.slug },
  destructive: true,
  submitLabel: "Delete",
})

/** `before` is the later node the new one makes possible; null adds a node with no link. */
export function nodeCreate(plan: PlanSummary, before: { ref: string; title: string } | null, onDone: Done): OpRequest {
  const base = { op: "node.create", fixed: { plan: plan.slug }, submitLabel: "Create", onDone }
  if (before) {
    return {
      ...base,
      title: `New node before ${before.ref}`,
      description: `What "${before.title}" requires. Leave the level empty to place the node one full step before ${before.ref}.`,
      initial: { enables: [before.ref] },
    }
  }
  if (plan.nodeCount === 0) {
    return {
      ...base,
      title: "Create the target",
      description: "The first node is the target. Leave the level empty to use the target value of the plan.",
    }
  }
  return { ...base, title: "New node" }
}

export const nodeUpdate = (node: NodeView): OpRequest => ({
  op: "node.update",
  title: `Edit ${node.ref}`,
  fixed: { plan: node.plan, ref: node.ref },
  initial: {
    title: node.title,
    description: node.description,
    level: node.level ?? undefined,
    status: node.status,
    size: node.size,
    duration: node.duration ?? undefined,
    due: node.due ?? undefined,
  },
  changesOnly: true,
  submitLabel: "Save",
})

export const nodeDelete = (node: NodeView): OpRequest => ({
  op: "node.delete",
  title: `Delete ${node.ref}?`,
  description: `"${node.title}" is deleted with its criteria, requirements, resources, messages, and the requirements of later nodes it provides.`,
  fixed: { plan: node.plan, ref: node.ref },
  destructive: true,
  submitLabel: "Delete",
})

export const criterionAdd = (node: NodeView): OpRequest => ({
  op: "criterion.add",
  title: `Add a success criterion to ${node.ref}`,
  fixed: at(node),
  submitLabel: "Add",
})

export const criterionUpdate = (node: NodeView, item: CheckItem): OpRequest => ({
  op: "criterion.update",
  title: `Edit criterion ${item.slug} of ${node.ref}`,
  fixed: { ...at(node), criterion: item.slug },
  initial: { text: item.text, met: item.met, slug: item.slug },
  changesOnly: true,
  submitLabel: "Save",
})

export const itemRemove = (entity: ListEntity, node: NodeView, item: CheckItem): OpRequest => ({
  op: `${entity}.remove`,
  title: `Remove ${WHAT[entity]} ${item.slug} from ${node.ref}?`,
  description: item.text,
  fixed: { ...at(node), [entity]: item.slug },
  destructive: true,
  submitLabel: "Remove",
})

export const requirementAdd = (node: NodeView): OpRequest => ({
  op: "requirement.add",
  title: `Add a requirement to ${node.ref}`,
  description: "What must be true before work on it can start. Exactly one former node provides it; it is met once that node is done.",
  fixed: at(node),
  submitLabel: "Add",
})

export const requirementUpdate = (node: NodeView, item: RequirementView): OpRequest => ({
  op: "requirement.update",
  title: `Edit requirement ${item.slug} of ${node.ref}`,
  description: "Change its wording, its slug, or the former node that provides it. A link that closes a loop is refused.",
  fixed: { ...at(node), requirement: item.slug },
  initial: { text: item.text, providedBy: item.providedBy, slug: item.slug },
  changesOnly: true,
  submitLabel: "Save",
})

export const resourceAdd = (node: NodeView): OpRequest => ({
  op: "resource.add",
  title: `Add a resource to ${node.ref}`,
  description: "Any kind: human, computing, capital, machine, or anything else.",
  fixed: at(node),
  submitLabel: "Add",
})

export const resourceUpdate = (node: NodeView, resource: ResourceView): OpRequest => ({
  op: "resource.update",
  title: `Edit resource ${resource.slug} of ${node.ref}`,
  fixed: { ...at(node), resource: resource.slug },
  initial: {
    kind: resource.kind,
    name: resource.name,
    quantity: resource.quantity,
    unit: resource.unit,
    provides: resource.provides,
    slug: resource.slug,
  },
  changesOnly: true,
  submitLabel: "Save",
})

export const resourceRemove = (node: NodeView, resource: ResourceView): OpRequest => ({
  op: "resource.remove",
  title: `Remove resource ${resource.slug} from ${node.ref}?`,
  description: `${resource.kind}: ${resource.name}`,
  fixed: { ...at(node), resource: resource.slug },
  destructive: true,
  submitLabel: "Remove",
})

export const obstacleAdd = (node: NodeView): OpRequest => ({
  op: "obstacle.add",
  title: `Add an obstacle to ${node.ref}`,
  description: "What could stop it, and how it is solved or worked around.",
  fixed: at(node),
  submitLabel: "Add",
})

export const obstacleUpdate = (node: NodeView, o: ObstacleView): OpRequest => ({
  op: "obstacle.update",
  title: `Edit obstacle ${o.slug} of ${node.ref}`,
  fixed: { ...at(node), obstacle: o.slug },
  initial: { text: o.text, fix: o.fix, status: o.status, slug: o.slug },
  changesOnly: true,
  submitLabel: "Save",
})

export const obstacleRemove = (node: NodeView, o: ObstacleView): OpRequest => ({
  op: "obstacle.remove",
  title: `Remove obstacle ${o.slug} from ${node.ref}?`,
  description: o.text,
  fixed: { ...at(node), obstacle: o.slug },
  destructive: true,
  submitLabel: "Remove",
})

export const messageAdd = (node: NodeView): OpRequest => ({
  op: "message.add",
  title: `Post a message under ${node.ref}`,
  description: "A note, a question or a decision about this node.",
  fixed: at(node),
  submitLabel: "Post",
})

export const messageUpdate = (node: NodeView, message: MessageView): OpRequest => ({
  op: "message.update",
  title: `Edit message ${message.id} of ${node.ref}`,
  fixed: { ...at(node), message: message.id },
  initial: { text: message.text, author: message.author },
  changesOnly: true,
  submitLabel: "Save",
})

export const messageRemove = (node: NodeView, message: MessageView): OpRequest => ({
  op: "message.remove",
  title: `Remove message ${message.id} from ${node.ref}?`,
  description: `${message.author}: ${message.text}`,
  fixed: { ...at(node), message: message.id },
  destructive: true,
  submitLabel: "Remove",
})
