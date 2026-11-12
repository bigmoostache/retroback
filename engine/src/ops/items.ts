/**
 * Operations on what a node carries: criteria, requirements, resources.
 * Each item is addressed by its slug, unique in its node, never by position.
 */
import { z } from "zod"
import { db } from "../db.ts"
import { uniqueSlug } from "../slug.ts"
import type { ItemList, NodeView, ResourceTotals } from "../types.ts"
import { loadNode, loadPlan, nodeOf } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"
import { assertNoLoop, assertOrder } from "./node.ts"

const nodeFlag = z.string().describe("Node ref, e.g. N3.")
const slugFlag = (what: string) =>
  z.string().min(1).describe(`Slug of the ${what}, as shown by rb node show.`)
const newSlugFlag = (from: string) =>
  z.string().min(1).optional().describe(`Handle of the item, unique in the node. Derived from the ${from} when omitted.`)
const renameFlag = z.string().min(1).optional().describe("New slug, unique in the node.")
const byPosition = { orderBy: { position: "asc" } } as const

interface Row {
  id: string
  slug: string
  position: number
}

type Found = Awaited<ReturnType<typeof nodeOf>>

/** The row with this slug, or a not_found error listing the slugs there are. */
function rowWith<T extends Row>(rows: T[], slug: string, what: string, ref: string): T {
  const row = rows.find((r) => r.slug === slug.trim().toLowerCase())
  if (row) return row
  const known = rows.map((r) => r.slug).join(", ")
  throw new OpError(`${ref} has no ${what} "${slug}"${known ? ` (it has: ${known})` : ` (it has none)`}.`, "not_found")
}

const nextPosition = (rows: Row[]) => Math.max(0, ...rows.map((r) => r.position)) + 1

/** The slug for a new item: the one asked for, which must be free, or one derived from its text. */
function slugFor(rows: Row[], asked: string | undefined, text: string, what: string, ref: string): string {
  const taken = rows.map((r) => r.slug)
  if (asked === undefined) return uniqueSlug(text, taken)
  const slug = uniqueSlug(asked, [])
  if (taken.includes(slug)) throw new OpError(`${ref} already has a ${what} "${slug}".`, "conflict")
  return slug
}

/** A rename: the new slug, checked free among the other rows. */
function renamed(rows: Row[], row: Row, asked: string | undefined, what: string, ref: string) {
  if (asked === undefined) return {}
  const slug = uniqueSlug(asked, [])
  if (rows.some((r) => r.id !== row.id && r.slug === slug)) {
    throw new OpError(`${ref} already has a ${what} "${slug}".`, "conflict")
  }
  return { slug }
}

const done = (found: Found) => loadNode(found.plan.slug, found.node.ref)

/** The items of one node, as `criterion list` and the others answer. */
async function listOf<T>(plan: string | undefined, ref: string, pick: (node: NodeView) => T[]): Promise<ItemList<T>> {
  const found = await nodeOf(plan, ref)
  const node = await loadNode(found.plan.slug, found.node.ref)
  return { plan: node.plan, node: node.ref, items: pick(node) }
}

// ---------------------------------------------------------------- criteria

const criterionRows = (nodeId: string) => db.criterion.findMany({ where: { nodeId }, ...byPosition })

const criterionOps = [
  defineOp({
    name: "criterion.list",
    summary: "List the success criteria of a node, with their slug and whether they are met.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, node: nodeFlag }),
    run: async ({ plan, node }) => listOf(plan, node, (n) => n.criteria),
  }),
  defineOp({
    name: "criterion.add",
    summary: "Add a success criterion to a node. Make it precise: a number, a date or a threshold that can be checked.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      text: z.string().min(1).describe("The success criterion."),
      slug: newSlugFlag("text"),
    }),
    run: async ({ plan, node, text, slug }) => {
      const found = await nodeOf(plan, node)
      const rows = await criterionRows(found.node.id)
      await db.criterion.create({
        data: {
          nodeId: found.node.id,
          position: nextPosition(rows),
          text,
          slug: slugFor(rows, slug, text, "criterion", found.node.ref),
        },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "criterion.update",
    summary: "Reword a success criterion, rename its slug, or mark it met or not met.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      criterion: slugFlag("criterion"),
      text: z.string().min(1).optional().describe("The success criterion."),
      met: z.boolean().optional().describe("true once it holds, false otherwise."),
      slug: renameFlag,
    }),
    run: async ({ plan, node, criterion, slug, ...data }) => {
      const found = await nodeOf(plan, node)
      const rows = await criterionRows(found.node.id)
      const row = rowWith(rows, criterion, "criterion", found.node.ref)
      await db.criterion.update({
        where: { id: row.id },
        data: { ...data, ...renamed(rows, row, slug, "criterion", found.node.ref) },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "criterion.remove",
    summary: "Remove a success criterion from a node.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, criterion: slugFlag("criterion") }),
    run: async ({ plan, node, criterion }) => {
      const found = await nodeOf(plan, node)
      const row = rowWith(await criterionRows(found.node.id), criterion, "criterion", found.node.ref)
      await db.criterion.delete({ where: { id: row.id } })
      return done(found)
    },
  }),
]

// ------------------------------------------------------------ requirements

const requirementRows = (nodeId: string) => db.requirement.findMany({ where: { nodeId }, ...byPosition })

/** The former node that will provide a requirement of `found`, checked against loops. */
async function providerFor(found: Found, ref: string) {
  const former = await nodeOf(found.plan.slug, ref)
  await assertNoLoop(found.plan.id, found.node, former.node)
  assertOrder(found.plan, former.node, found.node)
  return former.node
}

const providedByFlag = z.string().min(1).describe("Ref of the former node that provides it, e.g. N7.")

const requirementOps = [
  defineOp({
    name: "requirement.list",
    summary: "List the requirements of a node: slug, text, the node that provides each one, and whether it is met.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, node: nodeFlag }),
    run: async ({ plan, node }) => listOf(plan, node, (n) => n.requirements),
  }),
  defineOp({
    name: "requirement.add",
    summary:
      "Add a requirement to a node: what must be true before work on it can start. Exactly one former node provides it, and it is met once that node is done.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      text: z.string().min(1).describe("The requirement."),
      providedBy: providedByFlag,
      slug: newSlugFlag("text"),
    }),
    run: async ({ plan, node, text, providedBy, slug }) => {
      const found = await nodeOf(plan, node)
      const provider = await providerFor(found, providedBy)
      const rows = await requirementRows(found.node.id)
      await db.requirement.create({
        data: {
          nodeId: found.node.id,
          position: nextPosition(rows),
          text,
          slug: slugFor(rows, slug, text, "requirement", found.node.ref),
          providerId: provider.id,
        },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "requirement.update",
    summary: "Reword a requirement, rename its slug, or change the former node that provides it. The plan must stay free of loops.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      requirement: slugFlag("requirement"),
      text: z.string().min(1).optional().describe("The requirement."),
      providedBy: providedByFlag.optional(),
      slug: renameFlag,
    }),
    run: async ({ plan, node, requirement, text, providedBy, slug }) => {
      const found = await nodeOf(plan, node)
      const rows = await requirementRows(found.node.id)
      const row = rowWith(rows, requirement, "requirement", found.node.ref)
      const provider = providedBy === undefined ? undefined : await providerFor(found, providedBy)
      await db.requirement.update({
        where: { id: row.id },
        data: {
          ...(text === undefined ? {} : { text }),
          ...(provider ? { providerId: provider.id } : {}),
          ...renamed(rows, row, slug, "requirement", found.node.ref),
        },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "requirement.remove",
    summary: "Remove a requirement from a node, and with it the link to the node that provides it.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, requirement: slugFlag("requirement") }),
    run: async ({ plan, node, requirement }) => {
      const found = await nodeOf(plan, node)
      const row = rowWith(await requirementRows(found.node.id), requirement, "requirement", found.node.ref)
      await db.requirement.delete({ where: { id: row.id } })
      return done(found)
    },
  }),
]

// --------------------------------------------------------------- resources

const resourceRows = (nodeId: string) => db.resourceNeed.findMany({ where: { nodeId }, ...byPosition })

const resourceOps = [
  defineOp({
    name: "resource.list",
    summary: "List the resources of a node. Without --node: the resources summed over the whole plan, with the nodes that need them.",
    mutates: false,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag.optional().describe("Node ref, e.g. N3. Omit it for the totals of the plan."),
    }),
    run: async ({ plan, node }) => {
      if (node !== undefined) return listOf(plan, node, (n) => n.resources)
      const view = await loadPlan(plan)
      const result: ResourceTotals = { plan: view.slug, resources: view.resources }
      return result
    },
  }),
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
      provides: z
        .boolean()
        .default(false)
        .describe("The node brings this in once done (e.g. a funding round brings cash) instead of using it."),
      slug: newSlugFlag("name"),
    }),
    run: async ({ plan, node, slug, ...data }) => {
      const found = await nodeOf(plan, node)
      const rows = await resourceRows(found.node.id)
      await db.resourceNeed.create({
        data: {
          ...data,
          nodeId: found.node.id,
          position: nextPosition(rows),
          slug: slugFor(rows, slug, data.name, "resource", found.node.ref),
        },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "resource.update",
    summary: "Change a resource of a node, or rename its slug.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      resource: slugFlag("resource"),
      kind: z.string().min(1).optional().describe("Kind of resource."),
      name: z.string().min(1).optional().describe("What exactly."),
      quantity: z.number().positive().optional().describe("How much."),
      unit: z.string().min(1).optional().describe("Unit of the quantity."),
      provides: z.boolean().optional().describe("true when the node brings it in, false when it uses it."),
      slug: renameFlag,
    }),
    run: async ({ plan, node, resource, slug, ...data }) => {
      const found = await nodeOf(plan, node)
      const rows = await resourceRows(found.node.id)
      const row = rowWith(rows, resource, "resource", found.node.ref)
      await db.resourceNeed.update({
        where: { id: row.id },
        data: { ...data, ...renamed(rows, row, slug, "resource", found.node.ref) },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "resource.remove",
    summary: "Remove a resource from a node.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, resource: slugFlag("resource") }),
    run: async ({ plan, node, resource }) => {
      const found = await nodeOf(plan, node)
      const row = rowWith(await resourceRows(found.node.id), resource, "resource", found.node.ref)
      await db.resourceNeed.delete({ where: { id: row.id } })
      return done(found)
    },
  }),
]

// --------------------------------------------------------------- obstacles

const obstacleRows = (nodeId: string) => db.obstacle.findMany({ where: { nodeId }, ...byPosition })
const obstacleStatus = z.enum(["open", "fixed"])

const obstacleOps = [
  defineOp({
    name: "obstacle.list",
    summary: "List what could stop a node: slug, text, fix, open or fixed.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, node: nodeFlag }),
    run: async ({ plan, node }) => listOf(plan, node, (n) => n.obstacles),
  }),
  defineOp({
    name: "obstacle.add",
    summary: "Add an obstacle to a node: what could stop it, and how it is solved or worked around.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      text: z.string().min(1).describe("What could stop the node."),
      fix: z.string().default("").describe("How it is solved or worked around. Empty when not known yet."),
      status: obstacleStatus.default("open").describe("open until it is handled, then fixed."),
      slug: newSlugFlag("text"),
    }),
    run: async ({ plan, node, slug, ...data }) => {
      const found = await nodeOf(plan, node)
      const rows = await obstacleRows(found.node.id)
      await db.obstacle.create({
        data: {
          ...data,
          nodeId: found.node.id,
          position: nextPosition(rows),
          slug: slugFor(rows, slug, data.text, "obstacle", found.node.ref),
        },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "obstacle.update",
    summary: "Reword an obstacle, change its fix, mark it open or fixed, or rename its slug.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      obstacle: slugFlag("obstacle"),
      text: z.string().min(1).optional().describe("What could stop the node."),
      fix: z.string().optional().describe("How it is solved or worked around."),
      status: obstacleStatus.optional().describe("open or fixed."),
      slug: renameFlag,
    }),
    run: async ({ plan, node, obstacle, slug, ...data }) => {
      const found = await nodeOf(plan, node)
      const rows = await obstacleRows(found.node.id)
      const row = rowWith(rows, obstacle, "obstacle", found.node.ref)
      await db.obstacle.update({
        where: { id: row.id },
        data: { ...data, ...renamed(rows, row, slug, "obstacle", found.node.ref) },
      })
      return done(found)
    },
  }),
  defineOp({
    name: "obstacle.remove",
    summary: "Remove an obstacle from a node.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, obstacle: slugFlag("obstacle") }),
    run: async ({ plan, node, obstacle }) => {
      const found = await nodeOf(plan, node)
      const row = rowWith(await obstacleRows(found.node.id), obstacle, "obstacle", found.node.ref)
      await db.obstacle.delete({ where: { id: row.id } })
      return done(found)
    },
  }),
]

export const itemOps = [...criterionOps, ...requirementOps, ...resourceOps, ...obstacleOps]
