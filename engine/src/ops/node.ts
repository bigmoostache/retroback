import { z } from "zod"
import { db } from "../db.ts"
import { requires, unlock, unlockSize } from "../graph.ts"
import { prerequisiteLevel } from "../rules.ts"
import type { UnlockView } from "../types.ts"
import { loadNode, loadPlan, nodeOf, normRef, planOf } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const refFlag = z.string().describe("Node ref, e.g. N3.")
const sizeFlag = z.number().int().min(0).max(100).describe("How big the node is, from 0 (tiny) to 100 (largest).")

/** For each node id of a plan, the ids of the nodes that provide its requirements. */
export async function prereqsOf(planId: string): Promise<Map<string, string[]>> {
  const rows = await db.requirementProvider.findMany({
    where: { node: { planId } },
    select: { nodeId: true, requirement: { select: { nodeId: true } } },
  })
  const prereqs = new Map<string, string[]>()
  for (const row of rows) {
    const list = prereqs.get(row.requirement.nodeId) ?? []
    list.push(row.nodeId)
    prereqs.set(row.requirement.nodeId, list)
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
    summary: "List the nodes of a plan, from the target back to the present.",
    mutates: false,
    input: z.strictObject({ plan: planFlag }),
    run: async ({ plan }) => (await loadPlan(plan)).nodes,
  }),

  defineOp({
    name: "node.show",
    summary: "Show one node: criteria, requirements and who provides them, resources, gap and messages.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, ref: refFlag }),
    run: async ({ plan, ref }) => loadNode((await planOf(plan)).slug, ref),
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
        nodes: unlock(view.nodes, prereqs, target.ref),
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
        .number()
        .int()
        .min(1)
        .optional()
        .describe("With a single --enables: provide that existing requirement of it instead of adding one."),
      level: z
        .number()
        .optional()
        .describe("Metric value reached once done. Default: one full step before the enabled node, or the target value for the first node."),
      size: sizeFlag.default(50),
      criterion: z.array(z.string().min(1)).default([]).describe("Success criterion, precise and checkable. Repeatable."),
      requirement: z
        .array(z.string().min(1))
        .default([])
        .describe("Requirement to start the node that no node provides yet. Repeatable."),
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
        const rows = await db.requirement.findMany({ where: { nodeId: later.id }, orderBy: { position: "asc" } })
        const row = rows[input.forRequirement - 1]
        if (!row) {
          throw new OpError(`${later.ref} has no requirement ${input.forRequirement} (it has ${rows.length}).`, "not_found")
        }
        existingRequirement = row.id
      }

      let level = input.level
      if (level === undefined) {
        if (enables.length > 0) level = prerequisiteLevel(plan, enables)
        else if (existing.length === 0) level = plan.targetValue
        else {
          throw new OpError("Pass --enables <ref> to place the node one step before a later node, or --level <value>.")
        }
      }

      const seq = Math.max(0, ...existing.map((n) => n.seq)) + 1
      const ref = `N${seq}`
      const asItems = (texts: string[]) => texts.map((text, i) => ({ text, position: i + 1 }))
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
            criteria: { create: asItems(input.criterion) },
            requirements: { create: asItems(input.requirement) },
          },
        })
        if (existingRequirement) {
          await tx.requirementProvider.create({ data: { requirementId: existingRequirement, nodeId: node.id } })
          return
        }
        for (const later of enables) {
          const last = await tx.requirement.aggregate({ where: { nodeId: later.id }, _max: { position: true } })
          await tx.requirement.create({
            data: {
              nodeId: later.id,
              position: (last._max.position ?? 0) + 1,
              text: input.title,
              providers: { create: { nodeId: node.id } },
            },
          })
        }
      })
      return loadNode(plan.slug, ref)
    },
  }),

  defineOp({
    name: "node.update",
    summary: "Change the title, description, level, status or size of a node.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      ref: refFlag,
      title: z.string().min(1).optional().describe("Node title."),
      description: z.string().optional().describe("What the node is about."),
      level: z.number().optional().describe("Metric value reached once done."),
      status: z.enum(["todo", "doing", "done"]).optional().describe("Progress of the node."),
      size: sizeFlag.optional(),
    }),
    run: async ({ plan, ref, ...data }) => {
      const found = await nodeOf(plan, ref)
      await db.node.update({ where: { id: found.node.id }, data })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),

  defineOp({
    name: "node.delete",
    summary: "Delete a node, with its criteria, requirements, resources, messages and the links where it provides a requirement.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, ref: refFlag }),
    run: async ({ plan, ref }) => {
      const found = await nodeOf(plan, ref)
      await db.node.delete({ where: { id: found.node.id } })
      return { deleted: found.node.ref }
    },
  }),
]
