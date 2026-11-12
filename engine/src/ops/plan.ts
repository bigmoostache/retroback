import { z } from "zod"
import { db } from "../db.ts"
import { loadPlan, planOf, summarise } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)

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
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { nodes: true } } },
      })
      return plans.map((p) => summarise(p, p._count.nodes))
    },
  }),

  defineOp({
    name: "plan.show",
    summary: "Show a plan: its nodes from the target back to the present, resource totals and check.",
    mutates: false,
    input: z.strictObject({ plan: planFlag }),
    run: ({ plan }) => loadPlan(plan),
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
      const slug = slugify(input.slug ?? input.title)
      if (!slug) throw new OpError("The slug is empty: pass --slug.")
      if (await db.plan.findUnique({ where: { slug } })) {
        throw new OpError(`A plan "${slug}" already exists.`, "conflict")
      }
      await db.plan.create({ data: { ...input, slug } })
      return loadPlan(slug)
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
      return loadPlan(current.slug)
    },
  }),

  defineOp({
    name: "plan.delete",
    summary: "Delete a plan and all its nodes.",
    mutates: true,
    input: z.strictObject({ plan: z.string().describe("Plan slug.") }),
    run: async ({ plan }) => {
      const current = await planOf(plan)
      await db.plan.delete({ where: { id: current.id } })
      return { deleted: current.slug }
    },
  }),
]
