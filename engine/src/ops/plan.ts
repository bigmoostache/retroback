import { z } from "zod"
import { assertOwner, currentUser, visiblePlans } from "../access.ts"
import { db } from "../db.ts"
import { slugify } from "../slug.ts"
import { briefOf, loadPlan, planOf, summarise } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"
import { pageFlags } from "./node.ts"

function assertScale(s: { presentValue: number; targetValue: number; gapPercent: number }) {
  if (s.presentValue === s.targetValue) {
    throw new OpError("The present value and the target value are equal: there is nothing to plan.")
  }
  if (s.gapPercent <= 0) throw new OpError("The gap must be above 0%.")
}

export const planOps = [
  defineOp({
    name: "plan.list",
    summary: "List the plans.",
    mutates: false,
    input: z.strictObject({}),
    run: async () => {
      const plans = await db.plan.findMany({
        where: visiblePlans(),
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { nodes: true } } },
      })
      return plans.map((p) => summarise(p, p._count.nodes))
    },
  }),

  defineOp({
    name: "plan.show",
    summary:
      "Show a plan: its fields, the check counts and a page of its nodes, one line each. --full gives every node in full, the resource totals and the check issues.",
    mutates: false,
    input: z.strictObject({
      plan: planFlag,
      full: z.boolean().default(false).describe("Everything, every node in full. Can be large: meant for the web app and scripts."),
      ...pageFlags,
    }),
    run: async ({ plan, full, ...page }) => {
      const view = await loadPlan(plan)
      return full ? view : briefOf(view, page)
    },
  }),

  defineOp({
    name: "plan.check",
    summary: "Check a plan: gap between nodes (1% rule), target reached, criteria, requirements, resources.",
    mutates: false,
    input: z.strictObject({ plan: planFlag }),
    run: async ({ plan }) => (await loadPlan(plan)).check,
  }),

  defineOp({
    name: "plan.create",
    summary: "Create a plan: one metric, its value today and the value aimed at.",
    mutates: true,
    input: z.strictObject({
      title: z.string().min(1).describe("Plan title."),
      target: z.string().min(1).describe("The target statement: what is true in the future."),
      metric: z.string().min(1).describe("What is measured to tell how far along the plan is."),
      unit: z.string().min(1).describe("Unit of the metric, e.g. EUR, users, %."),
      presentValue: z.number().describe("Value of the metric today."),
      targetValue: z.number().describe("Value of the metric at the target."),
      gapPercent: z.number().default(1).describe("Largest step allowed between a node and what it starts from, in percent."),
      slug: z.string().optional().describe("Short handle. Derived from the title when omitted."),
    }),
    run: async (input) => {
      assertScale(input)
      const user = currentUser()
      const slug = slugify(input.slug ?? input.title)
      if (!slug) throw new OpError("The slug is empty: pass --slug.")
      if (await db.plan.findUnique({ where: { slug } })) {
        throw new OpError(`A plan "${slug}" already exists.`, "conflict")
      }
      await db.plan.create({
        data: {
          ...input,
          slug,
          // The creator is the owner, the only one. The engine itself creates ownerless plans (tests, maintenance).
          ...(user ? { members: { create: { userId: user.id, role: "owner" as const } } } : {}),
        },
      })
      return briefOf(await loadPlan(slug))
    },
  }),

  defineOp({
    name: "plan.update",
    summary: "Change the fields of a plan.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      title: z.string().min(1).optional().describe("Plan title."),
      target: z.string().min(1).optional().describe("The target statement."),
      metric: z.string().min(1).optional().describe("What is measured."),
      unit: z.string().min(1).optional().describe("Unit of the metric."),
      presentValue: z.number().optional().describe("Value of the metric today."),
      targetValue: z.number().optional().describe("Value of the metric at the target."),
      gapPercent: z.number().optional().describe("Largest step allowed, in percent."),
    }),
    run: async ({ plan, ...data }) => {
      const current = await planOf(plan)
      assertScale({
        presentValue: data.presentValue ?? current.presentValue,
        targetValue: data.targetValue ?? current.targetValue,
        gapPercent: data.gapPercent ?? current.gapPercent,
      })
      await db.plan.update({ where: { id: current.id }, data })
      return briefOf(await loadPlan(current.slug))
    },
  }),

  defineOp({
    name: "plan.delete",
    summary: "Delete a plan and all its nodes. Only its owner can.",
    mutates: true,
    input: z.strictObject({ plan: z.string().describe("Plan slug.") }),
    run: async ({ plan }) => {
      const current = await planOf(plan)
      await assertOwner(current)
      await db.plan.delete({ where: { id: current.id } })
      return { deleted: current.slug }
    },
  }),
]
