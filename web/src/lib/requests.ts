/**
 * The actions of the plan screen. Each one is an operation of the engine with
 * what the screen already knows filled in; the dialog shows its `rb` command.
 */
import type { CheckItem, MessageView, NodeView, PlanSummary, RequirementView, ResourceView } from "@engine/types.ts"
import type { Input } from "@/lib/api"

export interface OpRequest {
  /** Operation name, e.g. `node.create`. */
  op: string
  title: string
  description?: string | undefined
  /** Context of the action (plan, node, index): always sent, not shown as fields. */
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
export function nodeCreate(plan: PlanSummary, before: NodeView | null, onDone: Done): OpRequest {
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
    level: node.level,
    status: node.status,
    difficulty: node.difficulty,
  },
  changesOnly: true,
  submitLabel: "Save",
})

export const nodeDelete = (node: NodeView): OpRequest => ({
  op: "node.delete",
  title: `Delete ${node.ref}?`,
  description: `"${node.title}" is deleted with its criteria, requirements, resources, messages and the links where it provides a requirement.`,
  fixed: { plan: node.plan, ref: node.ref },
  destructive: true,
  submitLabel: "Delete",
})

export const itemAdd = (entity: ListEntity, node: NodeView): OpRequest => ({
  op: `${entity}.add`,
  title: `Add a ${WHAT[entity]} to ${node.ref}`,
  fixed: at(node),
  submitLabel: "Add",
})

export const itemUpdate = (entity: ListEntity, node: NodeView, item: CheckItem): OpRequest => ({
  op: `${entity}.update`,
  title: `Edit ${WHAT[entity]} ${item.index} of ${node.ref}`,
  fixed: { ...at(node), index: item.index },
  initial: { text: item.text, met: item.met },
  changesOnly: true,
  submitLabel: "Save",
})

export const itemRemove = (entity: ListEntity, node: NodeView, item: CheckItem): OpRequest => ({
  op: `${entity}.remove`,
  title: `Remove ${WHAT[entity]} ${item.index} from ${node.ref}?`,
  description: item.text,
  fixed: { ...at(node), index: item.index },
  destructive: true,
  submitLabel: "Remove",
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
  title: `Edit resource ${resource.index} of ${node.ref}`,
  fixed: { ...at(node), index: resource.index },
  initial: { kind: resource.kind, name: resource.name, quantity: resource.quantity, unit: resource.unit },
  changesOnly: true,
  submitLabel: "Save",
})

export const resourceRemove = (node: NodeView, resource: ResourceView): OpRequest => ({
  op: "resource.remove",
  title: `Remove resource ${resource.index} from ${node.ref}?`,
  description: `${resource.kind}: ${resource.name}`,
  fixed: { ...at(node), index: resource.index },
  destructive: true,
  submitLabel: "Remove",
})

export const requirementAdd = (node: NodeView): OpRequest => ({
  op: "requirement.add",
  title: `Add a requirement to ${node.ref}`,
  description: "What must be true before work on it can start. Name the former nodes that provide it, one per line, or none to tick it by hand.",
  fixed: at(node),
  submitLabel: "Add",
})

export const requirementLink = (node: NodeView, item: RequirementView): OpRequest => ({
  op: "requirement.link",
  title: `Who provides requirement ${item.index} of ${node.ref}?`,
  description: `${item.text}. The node must come before ${node.ref}: a link that closes a loop is refused.`,
  fixed: { ...at(node), index: item.index },
  submitLabel: "Link",
})

export const requirementUnlink = (node: NodeView, item: RequirementView, by: string): OpRequest => ({
  op: "requirement.unlink",
  title: `${by} no longer provides requirement ${item.index} of ${node.ref}?`,
  description: item.text,
  fixed: { ...at(node), index: item.index, by },
  destructive: true,
  submitLabel: "Unlink",
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
  title: `Edit message ${message.index} of ${node.ref}`,
  fixed: { ...at(node), index: message.index },
  initial: { text: message.text, author: message.author },
  changesOnly: true,
  submitLabel: "Save",
})

export const messageRemove = (node: NodeView, message: MessageView): OpRequest => ({
  op: "message.remove",
  title: `Remove message ${message.index} from ${node.ref}?`,
  description: `${message.author}: ${message.text}`,
  fixed: { ...at(node), index: message.index },
  destructive: true,
  submitLabel: "Remove",
})
