/** Reads the database and builds the shapes of types.ts. */
import { db } from "./db.ts"
import { OpError } from "./ops/define.ts"
import { checkPlan, computeGap } from "./rules.ts"
import type { NodeView, PlanSummary, PlanView, ResourceTotal } from "./types.ts"

export const normRef = (ref: string) => ref.trim().toUpperCase()

/** The plan with this slug, or the only plan when no slug is given. */
export async function planOf(slug?: string) {
  if (slug) {
    const plan = await db.plan.findUnique({ where: { slug } })
    if (!plan) throw new OpError(`No plan "${slug}".`, "not_found")
    return plan
  }
  const plans = await db.plan.findMany({ take: 2 })
  if (plans.length === 1) return plans[0]!
  throw new OpError(
    plans.length === 0
      ? "No plan yet. Create one with: rb plan create"
      : "Several plans exist: pass --plan <slug>. List them with: rb plan list",
  )
}

export async function nodeOf(planSlug: string | undefined, ref: string) {
  const plan = await planOf(planSlug)
  const node = await db.node.findUnique({ where: { planId_ref: { planId: plan.id, ref: normRef(ref) } } })
  if (!node) throw new OpError(`No node ${normRef(ref)} in plan "${plan.slug}".`, "not_found")
  return { plan, node }
}

export function summarise(
  plan: Omit<PlanSummary, "nodeCount">,
  nodeCount: number,
): PlanSummary {
  const { slug, title, target, metric, unit, presentValue, targetValue, gapPercent } = plan
  return { slug, title, target, metric, unit, presentValue, targetValue, gapPercent, nodeCount }
}

export async function loadPlan(slug?: string): Promise<PlanView> {
  const { id } = await planOf(slug)
  const byPosition = { orderBy: { position: "asc" } } as const
  const plan = await db.plan.findUniqueOrThrow({
    where: { id },
    include: {
      nodes: {
        orderBy: { seq: "asc" },
        include: {
          criteria: byPosition,
          requirements: { ...byPosition, include: { providers: { include: { node: { select: { ref: true, seq: true } } } } } },
          resources: byPosition,
          messages: byPosition,
        },
      },
    },
  })

  const byRef = new Map(plan.nodes.map((n) => [n.ref, n]))
  const bySeq = (a: string, b: string) => byRef.get(a)!.seq - byRef.get(b)!.seq
  const providersOf = (r: (typeof plan.nodes)[number]["requirements"][number]) =>
    r.providers.map((p) => p.node.ref).sort(bySeq)
  const prereqs = new Map(
    plan.nodes.map((n) => [n.ref, [...new Set(n.requirements.flatMap(providersOf))].sort(bySeq)] as const),
  )
  const enables = new Map<string, string[]>(plan.nodes.map((n) => [n.ref, []]))
  for (const [later, formers] of prereqs) for (const former of formers) enables.get(former)!.push(later)

  const nodes: NodeView[] = plan.nodes.map((n) => {
    const deps = prereqs.get(n.ref)!.map((ref) => byRef.get(ref)!)
    return {
      plan: plan.slug,
      ref: n.ref,
      seq: n.seq,
      title: n.title,
      description: n.description,
      level: n.level,
      status: n.status,
      size: n.size,
      criteria: n.criteria.map((c, i) => ({ index: i + 1, text: c.text, met: c.met })),
      requirements: n.requirements.map((r, i) => {
        const providedBy = providersOf(r)
        const met = providedBy.length ? providedBy.every((ref) => byRef.get(ref)!.status === "done") : r.met
        return { index: i + 1, text: r.text, met, providedBy }
      }),
      resources: n.resources.map((r, i) => ({
        index: i + 1,
        kind: r.kind,
        name: r.name,
        quantity: r.quantity,
        unit: r.unit,
      })),
      dependsOn: deps.map((d) => d.ref),
      enables: enables.get(n.ref)!.sort(bySeq),
      gap: computeGap(n.level, deps, plan),
      messages: n.messages.map((m, i) => ({
        index: i + 1,
        author: m.author,
        text: m.text,
        at: m.createdAt.toISOString(),
        edited: m.editedAt !== null,
      })),
    }
  })

  const totals = new Map<string, ResourceTotal>()
  for (const n of nodes) {
    for (const r of n.resources) {
      const key = `${r.kind}\u0000${r.name}\u0000${r.unit}`
      const total = totals.get(key) ?? { kind: r.kind, name: r.name, unit: r.unit, quantity: 0, nodes: [] }
      total.quantity += r.quantity
      total.nodes.push(n.ref)
      totals.set(key, total)
    }
  }
  const resources = [...totals.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  )

  return { ...summarise(plan, nodes.length), nodes, resources, check: checkPlan(plan, nodes) }
}

export async function loadNode(planSlug: string, ref: string): Promise<NodeView> {
  const plan = await loadPlan(planSlug)
  const node = plan.nodes.find((n) => n.ref === normRef(ref))
  if (!node) throw new OpError(`No node ${normRef(ref)} in plan "${plan.slug}".`, "not_found")
  return node
}
