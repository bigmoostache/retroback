import { z } from "zod"
import { db } from "../db.ts"
import { requires, unlock, unlockSize } from "../graph.ts"
import { direction, prerequisiteLevel } from "../rules.ts"
import { uniqueSlug } from "../slug.ts"
import type { NodeView, TreeNode, TreeView, UnlockView } from "../types.ts"
import { loadNode, loadPlan, MAX_PAGE, nodeOf, normRef, PAGE, pageNodes, planOf, summariseNode } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const MAX_DEPTH = 5
const TREE_CAP = 100

const refFlag = z.string().describe("Node ref, e.g. N3.")
const sizeFlag = z.number().int().min(0).max(100).describe("How big the node is, from 0 (tiny) to 100 (largest).")
const durationFlag = z.number().min(0).describe("How long the work takes, in days.")
const dueFlag = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .describe("Date it must be done by, YYYY-MM-DD. `plan check` fails when its earliest finish is later.")

/**
 * Refuses a provider whose level is beyond the level of the node it provides
 * for: work must not go backward. Milestones (no level) are never refused.
 */
export function assertOrder(
  plan: { presentValue: number; targetValue: number },
  provider: { ref: string; level: number | null },
  later: { ref: string; level: number | null },
) {
  if (provider.level === null || later.level === null) return
  if (direction(plan) * (provider.level - later.level) > 1e-9) {
    throw new OpError(
      `${provider.ref} (${provider.level}) is beyond ${later.ref} (${later.level}): a node cannot provide for a node it is ahead of.`,
      "conflict",
    )
  }
}

/** Filters and paging of node lists. Shared with plan.show. */
export const pageFlags = {
  status: z.enum(["todo", "doing", "done"]).optional().describe("Only the nodes with this status."),
  ready: z
    .boolean()
    .optional()
    .describe("Only the nodes that can start today: not done, everything they require done, plan start reached."),
  after: z.string().optional().describe("Only the nodes after this ref: the next page, as given at the end of a cut list."),
  limit: z.number().int().min(1).max(MAX_PAGE).default(PAGE).describe(`How many nodes at most (${MAX_PAGE} at most).`),
}

/** For each node id of a plan, the ids of the nodes that provide its requirements. */
export async function prereqsOf(planId: string): Promise<Map<string, string[]>> {
  const rows = await db.requirement.findMany({
    where: { node: { planId } },
    select: { nodeId: true, providerId: true },
  })
  const prereqs = new Map<string, string[]>()
  for (const row of rows) {
    const list = prereqs.get(row.nodeId) ?? []
    list.push(row.providerId)
    prereqs.set(row.nodeId, list)
  }
  return prereqs
}

/** Refuses a link that would make `later` require itself, directly or not. */
export async function assertNoLoop(planId: string, later: { id: string; ref: string }, former: { id: string; ref: string }) {
  if (later.id === former.id) throw new OpError(`${later.ref} cannot provide its own requirement.`, "conflict")
  if (requires(await prereqsOf(planId), former.id, later.id)) {
    throw new OpError(`${former.ref} already requires ${later.ref}: this link would close a loop.`, "conflict")
  }
}

export const nodeOps = [
  defineOp({
    name: "node.list",
    summary: `List the nodes of a plan, one line each, from the target back to the present. ${PAGE} at a time by default: page with --after <ref>.`,
    mutates: false,
    input: z.strictObject({ plan: planFlag, ...pageFlags }),
    run: async ({ plan, ...page }) => pageNodes(await loadPlan(plan), page),
  }),

  defineOp({
    name: "node.show",
    summary: "Show one node: criteria, requirements and who provides them, resources, gap and messages.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, ref: refFlag }),
    run: async ({ plan, ref }) => loadNode((await planOf(plan)).slug, ref),
  }),

  defineOp({
    name: "node.tree",
    summary: `Show a node and what it requires, as a tree going back toward the present, down to --depth levels (1 by default, ${MAX_DEPTH} at most, ${TREE_CAP} nodes at most). A node reached twice is expanded once.`,
    mutates: false,
    input: z.strictObject({
      plan: planFlag,
      ref: refFlag,
      depth: z.number().int().min(1).max(MAX_DEPTH).default(1).describe(`How many levels of requirements to show (${MAX_DEPTH} at most).`),
    }),
    run: async ({ plan, ref, depth }) => {
      const view = await loadPlan((await planOf(plan)).slug)
      const byRef = new Map(view.nodes.map((n) => [n.ref, n]))
      const root = byRef.get(normRef(ref))
      if (!root) throw new OpError(`No node ${normRef(ref)} in plan "${view.slug}".`, "not_found")
      const expanded = new Set<string>()
      let shown = 0
      const build = (n: NodeView, level: number): TreeNode => {
        shown++
        const first = !expanded.has(n.ref)
        expanded.add(n.ref)
        const requires: TreeNode[] = []
        if (first && level < depth) {
          for (const p of n.dependsOn) {
            if (shown >= TREE_CAP) break
            requires.push(build(byRef.get(p)!, level + 1))
          }
        }
        return { ...summariseNode(n), requires, cut: requires.length < n.dependsOn.length }
      }
      const result: TreeView = { plan: view.slug, root: build(root, 0), depth, shown }
      return result
    },
  }),

  defineOp({
    name: "node.unlock",
    summary:
      "What to tackle now to reach a node: the nodes not done yet, among it and everything it requires, whose own requirements are all done. Also the size left: the heaviest path of sizes through what is not done, assuming perfect parallelism.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, ref: refFlag }),
    run: async ({ plan, ref }) => {
      const view = await loadPlan((await planOf(plan)).slug)
      const target = view.nodes.find((n) => n.ref === normRef(ref))
      if (!target) throw new OpError(`No node ${normRef(ref)} in plan "${view.slug}".`, "not_found")
      const prereqs = new Map(view.nodes.map((n) => [n.ref, n.dependsOn]))
      const result: UnlockView = {
        target: target.ref,
        nodes: unlock(view.nodes, prereqs, target.ref).map(summariseNode),
        size: unlockSize(view.nodes, prereqs, target.ref),
      }
      return result
    },
  }),

  defineOp({
    name: "node.create",
    summary:
      "Create a node. The first node is the target. After that, go backward: --enables <ref> creates what that node requires, one step before it, and adds the requirement it provides.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      title: z.string().min(1).describe("Node title."),
      description: z.string().default("").describe("What the node is about."),
      enables: z
        .array(z.string())
        .default([])
        .describe("Later node this one provides a requirement of. Repeatable. The requirement is worded as the title."),
      forRequirement: z
        .string()
        .min(1)
        .optional()
        .describe("With a single --enables: slug of an existing requirement of it that the new node provides instead, in place of its current provider."),
      level: z
        .number()
        .optional()
        .describe("Metric value reached once done. Default: one full step before the enabled node, or the target value for the first node."),
      size: sizeFlag.default(50),
      milestone: z
        .boolean()
        .default(false)
        .describe("A step that moves no metric (e.g. 'Seed round closed'): no level, no gap check. Measured nodes after it measure their gap through it."),
      duration: durationFlag.optional(),
      due: dueFlag.optional(),
      criterion: z.array(z.string().min(1)).default([]).describe("Success criterion, precise and checkable. Repeatable."),
    }),
    run: async (input) => {
      const plan = await planOf(input.plan)
      const existing = await db.node.findMany({ where: { planId: plan.id } })
      const find = (ref: string) => {
        const node = existing.find((n) => n.ref === normRef(ref))
        if (!node) throw new OpError(`No node ${normRef(ref)} in plan "${plan.slug}".`, "not_found")
        return node
      }
      const enables = [...new Set(input.enables.map(normRef))].map(find)

      let existingRequirement: string | null = null
      if (input.forRequirement !== undefined) {
        if (enables.length !== 1) throw new OpError("--for-requirement needs exactly one --enables.")
        const later = enables[0]!
        const slug = input.forRequirement.trim().toLowerCase()
        const row = await db.requirement.findUnique({ where: { nodeId_slug: { nodeId: later.id, slug } } })
        if (!row) throw new OpError(`${later.ref} has no requirement "${slug}".`, "not_found")
        existingRequirement = row.id
      }

      let level: number | null | undefined = input.level
      if (input.milestone) {
        if (level !== undefined) throw new OpError("A milestone has no level: pass --milestone or --level, not both.")
        level = null
      } else if (level === undefined) {
        const measured = enables.filter((n): n is typeof n & { level: number } => n.level !== null)
        if (measured.length > 0) level = prerequisiteLevel(plan, measured)
        else if (existing.length === 0) level = plan.targetValue
        else if (enables.length > 0) {
          throw new OpError("The nodes it enables are milestones: pass --level <value> or --milestone.")
        } else {
          throw new OpError("Pass --enables <ref> to place the node one step before a later node, --level <value>, or --milestone.")
        }
      }
      if (level !== null) for (const later of enables) assertOrder(plan, { ref: "the new node", level }, later)

      const seq = Math.max(0, ...existing.map((n) => n.seq)) + 1
      const ref = `N${seq}`
      const criteria: { text: string; position: number; slug: string }[] = []
      for (const [i, text] of input.criterion.entries()) {
        criteria.push({ text, position: i + 1, slug: uniqueSlug(text, criteria.map((c) => c.slug)) })
      }
      // A new node requires nothing yet, so linking it cannot close a loop.
      await db.$transaction(async (tx) => {
        const node = await tx.node.create({
          data: {
            planId: plan.id,
            ref,
            seq,
            title: input.title,
            description: input.description,
            level,
            size: input.size,
            duration: input.duration ?? null,
            due: input.due ? new Date(`${input.due}T00:00:00Z`) : null,
            criteria: { create: criteria },
          },
        })
        if (existingRequirement) {
          await tx.requirement.update({ where: { id: existingRequirement }, data: { providerId: node.id } })
          return
        }
        for (const later of enables) {
          const rows = await tx.requirement.findMany({ where: { nodeId: later.id }, select: { slug: true, position: true } })
          await tx.requirement.create({
            data: {
              nodeId: later.id,
              position: Math.max(0, ...rows.map((r) => r.position)) + 1,
              slug: uniqueSlug(input.title, rows.map((r) => r.slug)),
              text: input.title,
              providerId: node.id,
            },
          })
        }
      })
      return loadNode(plan.slug, ref)
    },
  }),

  defineOp({
    name: "node.update",
    summary:
      "Change a node: title, description, level (or --milestone), status, size, duration, due date. --no-duration / --no-due clear them.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      ref: refFlag,
      title: z.string().min(1).optional().describe("Node title."),
      description: z.string().optional().describe("What the node is about."),
      level: z.number().optional().describe("Metric value reached once done. Turns a milestone into a measured node."),
      milestone: z.boolean().optional().describe("Make it a milestone: it moves no metric, its level is dropped."),
      status: z.enum(["todo", "doing", "done"]).optional().describe("Progress of the node."),
      size: sizeFlag.optional(),
      duration: durationFlag.optional(),
      due: dueFlag.optional(),
      noDuration: z.boolean().optional().describe("Clear the duration: unknown again."),
      noDue: z.boolean().optional().describe("Clear the due date."),
    }),
    run: async ({ plan, ref, milestone, level, duration, due, noDuration, noDue, ...data }) => {
      const found = await nodeOf(plan, ref)
      if (milestone && level !== undefined) throw new OpError("Pass --milestone or --level, not both.")
      if (noDuration && duration !== undefined) throw new OpError("Pass --duration or --no-duration, not both.")
      if (noDue && due !== undefined) throw new OpError("Pass --due or --no-due, not both.")
      if (level !== undefined) {
        const node = { ref: found.node.ref, level }
        const links = await db.requirement.findMany({
          where: { OR: [{ nodeId: found.node.id }, { providerId: found.node.id }] },
          select: { nodeId: true, node: { select: { ref: true, level: true } }, provider: { select: { ref: true, level: true } } },
        })
        for (const l of links) {
          if (l.nodeId === found.node.id) assertOrder(found.plan, l.provider, node)
          else assertOrder(found.plan, node, l.node)
        }
      }
      await db.node.update({
        where: { id: found.node.id },
        data: {
          ...data,
          ...(milestone ? { level: null } : level !== undefined ? { level } : {}),
          ...(noDuration ? { duration: null } : duration !== undefined ? { duration } : {}),
          ...(noDue ? { due: null } : due !== undefined ? { due: new Date(`${due}T00:00:00Z`) } : {}),
        },
      })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),

  defineOp({
    name: "node.delete",
    summary: "Delete a node, with its criteria, requirements, resources, messages, and the requirements of later nodes it provides.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, ref: refFlag }),
    run: async ({ plan, ref }) => {
      const found = await nodeOf(plan, ref)
      await db.node.delete({ where: { id: found.node.id } })
      return { deleted: found.node.ref }
    },
  }),
]
