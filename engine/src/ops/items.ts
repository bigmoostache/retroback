/** Operations on what a node carries: criteria, requirements, resources. */
import { z } from "zod"
import { db } from "../db.ts"
import { loadNode, nodeOf } from "../views.ts"
import { defineOp, OpError, planFlag, type Op } from "./define.ts"
import { assertNoLoop } from "./node.ts"

const nodeFlag = z.string().describe("Node ref, e.g. N3.")
const indexFlag = z.number().int().min(1).describe("Position in the node's list, starting at 1.")
const byPosition = { orderBy: { position: "asc" } } as const

interface Row {
  id: string
  position: number
}

/** The row at a 1-based index of an ordered list. */
function rowAt<T extends Row>(rows: T[], index: number, what: string, ref: string): T {
  const row = rows[index - 1]
  if (!row) throw new OpError(`${ref} has no ${what} ${index} (it has ${rows.length}).`, "not_found")
  return row
}

const nextPosition = (rows: Row[]) => Math.max(0, ...rows.map((r) => r.position)) + 1

/** Criteria and the list of their operations (requirements have their own, below). */
interface Checklist {
  rows: (nodeId: string) => Promise<Row[]>
  add: (nodeId: string, position: number, text: string) => Promise<unknown>
  set: (id: string, data: { text?: string; met?: boolean }) => Promise<unknown>
  drop: (id: string) => Promise<unknown>
}

const criteria: Checklist = {
  rows: (nodeId) => db.criterion.findMany({ where: { nodeId }, ...byPosition }),
  add: (nodeId, position, text) => db.criterion.create({ data: { nodeId, position, text } }),
  set: (id, data) => db.criterion.update({ where: { id }, data }),
  drop: (id) => db.criterion.delete({ where: { id } }),
}

const requirementRows = (nodeId: string) =>
  db.requirement.findMany({ where: { nodeId }, ...byPosition, include: { providers: true } })

/** The former nodes named by refs, each checked against loops before linking. */
async function providersFor(found: Awaited<ReturnType<typeof nodeOf>>, refs: string[]) {
  const providers = []
  for (const ref of [...new Set(refs.map((r) => r.trim().toUpperCase()))]) {
    const former = await nodeOf(found.plan.slug, ref)
    await assertNoLoop(found.plan.id, found.node, former.node)
    providers.push(former.node)
  }
  return providers
}

const byFlag = z.string().describe("Ref of the former node that provides it, e.g. N7.")

const requirementOps = [
  defineOp({
    name: "requirement.add",
    summary:
      "Add a requirement to a node: what must be true before work on it can start. --provided-by links it to the former nodes that provide it.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      text: z.string().min(1).describe("The requirement."),
      providedBy: z.array(z.string()).default([]).describe("Former node that provides it. Repeatable."),
    }),
    run: async ({ plan, node, text, providedBy }) => {
      const found = await nodeOf(plan, node)
      const providers = await providersFor(found, providedBy)
      const position = nextPosition(await requirementRows(found.node.id))
      await db.requirement.create({
        data: {
          nodeId: found.node.id,
          position,
          text,
          providers: { create: providers.map((p) => ({ nodeId: p.id })) },
        },
      })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
  defineOp({
    name: "requirement.update",
    summary: "Reword a requirement, or mark it met or not met when no node provides it.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      index: indexFlag,
      text: z.string().min(1).optional().describe("The requirement."),
      met: z
        .boolean()
        .optional()
        .describe("true once it holds, false otherwise. Only without providers: otherwise it is met once they are all done."),
    }),
    run: async ({ plan, node, index, ...data }) => {
      const found = await nodeOf(plan, node)
      const row = rowAt(await requirementRows(found.node.id), index, "requirement", found.node.ref)
      if (data.met !== undefined && row.providers.length > 0) {
        throw new OpError(
          `${found.node.ref} requirement ${index} is provided by nodes: it is met once they are all done.`,
          "conflict",
        )
      }
      await db.requirement.update({ where: { id: row.id }, data })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
  defineOp({
    name: "requirement.remove",
    summary: "Remove a requirement from a node, with its links to the nodes that provide it.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, index: indexFlag }),
    run: async ({ plan, node, index }) => {
      const found = await nodeOf(plan, node)
      const row = rowAt(await requirementRows(found.node.id), index, "requirement", found.node.ref)
      await db.requirement.delete({ where: { id: row.id } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
  defineOp({
    name: "requirement.link",
    summary: "Say that a former node provides a requirement. The plan must stay free of loops.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, index: indexFlag, by: byFlag }),
    run: async ({ plan, node, index, by }) => {
      const found = await nodeOf(plan, node)
      const row = rowAt(await requirementRows(found.node.id), index, "requirement", found.node.ref)
      const [former] = await providersFor(found, [by])
      if (row.providers.some((p) => p.nodeId === former!.id)) {
        throw new OpError(`${former!.ref} already provides ${found.node.ref} requirement ${index}.`, "conflict")
      }
      await db.requirementProvider.create({ data: { requirementId: row.id, nodeId: former!.id } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
  defineOp({
    name: "requirement.unlink",
    summary: "Say that a node no longer provides a requirement.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, index: indexFlag, by: byFlag }),
    run: async ({ plan, node, index, by }) => {
      const found = await nodeOf(plan, node)
      const row = rowAt(await requirementRows(found.node.id), index, "requirement", found.node.ref)
      const former = await nodeOf(found.plan.slug, by)
      if (!row.providers.some((p) => p.nodeId === former.node.id)) {
        throw new OpError(`${former.node.ref} does not provide ${found.node.ref} requirement ${index}.`, "not_found")
      }
      await db.requirementProvider.delete({
        where: { requirementId_nodeId: { requirementId: row.id, nodeId: former.node.id } },
      })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
]

function checklistOps(entity: string, what: string, hint: string, table: Checklist): Op[] {
  return [
    defineOp({
      name: `${entity}.add`,
      summary: `Add a ${what} to a node. ${hint}`,
      mutates: true,
      input: z.strictObject({ plan: planFlag, node: nodeFlag, text: z.string().min(1).describe(`The ${what}.`) }),
      run: async ({ plan, node, text }) => {
        const found = await nodeOf(plan, node)
        await table.add(found.node.id, nextPosition(await table.rows(found.node.id)), text)
        return loadNode(found.plan.slug, found.node.ref)
      },
    }),
    defineOp({
      name: `${entity}.update`,
      summary: `Reword a ${what}, or mark it met or not met.`,
      mutates: true,
      input: z.strictObject({
        plan: planFlag,
        node: nodeFlag,
        index: indexFlag,
        text: z.string().min(1).optional().describe(`The ${what}.`),
        met: z.boolean().optional().describe("true once it holds, false otherwise."),
      }),
      run: async ({ plan, node, index, ...data }) => {
        const found = await nodeOf(plan, node)
        const row = rowAt(await table.rows(found.node.id), index, what, found.node.ref)
        await table.set(row.id, data)
        return loadNode(found.plan.slug, found.node.ref)
      },
    }),
    defineOp({
      name: `${entity}.remove`,
      summary: `Remove a ${what} from a node.`,
      mutates: true,
      input: z.strictObject({ plan: planFlag, node: nodeFlag, index: indexFlag }),
      run: async ({ plan, node, index }) => {
        const found = await nodeOf(plan, node)
        const row = rowAt(await table.rows(found.node.id), index, what, found.node.ref)
        await table.drop(row.id)
        return loadNode(found.plan.slug, found.node.ref)
      },
    }),
  ]
}

const resourceRows = (nodeId: string) => db.resourceNeed.findMany({ where: { nodeId }, ...byPosition })

const resourceOps = [
  defineOp({
    name: "resource.add",
    summary: "Add a resource a node needs. Any kind: human, computing, capital, machine, or anything else.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      kind: z.string().min(1).describe("Kind of resource, free text: human, computing, capital, machine..."),
      name: z.string().min(1).describe("What exactly, e.g. backend engineer, GPU A100, cash."),
      quantity: z.number().positive().describe("How much."),
      unit: z.string().min(1).describe("Unit of the quantity, e.g. person-days, hours, EUR."),
    }),
    run: async ({ plan, node, ...data }) => {
      const found = await nodeOf(plan, node)
      const position = nextPosition(await resourceRows(found.node.id))
      await db.resourceNeed.create({ data: { ...data, nodeId: found.node.id, position } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
  defineOp({
    name: "resource.update",
    summary: "Change a resource of a node.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      index: indexFlag,
      kind: z.string().min(1).optional().describe("Kind of resource."),
      name: z.string().min(1).optional().describe("What exactly."),
      quantity: z.number().positive().optional().describe("How much."),
      unit: z.string().min(1).optional().describe("Unit of the quantity."),
    }),
    run: async ({ plan, node, index, ...data }) => {
      const found = await nodeOf(plan, node)
      const row = rowAt(await resourceRows(found.node.id), index, "resource", found.node.ref)
      await db.resourceNeed.update({ where: { id: row.id }, data })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
  defineOp({
    name: "resource.remove",
    summary: "Remove a resource from a node.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, index: indexFlag }),
    run: async ({ plan, node, index }) => {
      const found = await nodeOf(plan, node)
      const row = rowAt(await resourceRows(found.node.id), index, "resource", found.node.ref)
      await db.resourceNeed.delete({ where: { id: row.id } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
]

export const itemOps = [
  ...checklistOps(
    "criterion",
    "success criterion",
    "Make it precise: a number, a date or a threshold that can be checked.",
    criteria,
  ),
  ...requirementOps,
  ...resourceOps,
]
