/** Reads the database and builds the shapes of types.ts. */
import { visiblePlans } from "./access.ts"
import { db } from "./db.ts"
import { depths } from "./graph.ts"
import { OpError } from "./ops/define.ts"
import { checkPlan, computeGap, direction } from "./rules.ts"
import { summariseNode } from "./summary.ts"
import type {
  NodePage,
  NodeStatus,
  NodeView,
  PlanBrief,
  PlanGraph,
  PlanSummary,
  PlanView,
  ResourceTotal,
  Schedule,
} from "./types.ts"

export const normRef = (ref: string) => ref.trim().toUpperCase()

/**
 * The plan with this slug, or the only plan when no slug is given, among the
 * plans the running user is a member of. Others answer not_found.
 */
export async function planOf(slug?: string) {
  if (slug) {
    const plan = await db.plan.findFirst({ where: { slug, ...visiblePlans() } })
    if (!plan) throw new OpError(`No plan "${slug}".`, "not_found")
    return plan
  }
  const plans = await db.plan.findMany({ where: visiblePlans(), take: 2 })
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
  // One flat query per table, grouped here: much faster than a nested include on large plans.
  const byPosition = { orderBy: { position: "asc" } } as const
  const where = { node: { planId: id } }
  const [row, nodeRows, criteria, requirements, resourceRows, obstacles, messages] = await Promise.all([
    db.plan.findUniqueOrThrow({ where: { id } }),
    db.node.findMany({ where: { planId: id }, orderBy: { seq: "asc" } }),
    db.criterion.findMany({ where, ...byPosition }),
    db.requirement.findMany({ where, ...byPosition }),
    db.resourceNeed.findMany({ where, ...byPosition }),
    db.obstacle.findMany({ where, ...byPosition }),
    db.message.findMany({ where, ...byPosition }),
  ])
  const refOf = new Map(nodeRows.map((n) => [n.id, n.ref]))
  const group = <T extends { nodeId: string }>(rows: T[]) => {
    const out = new Map<string, T[]>()
    for (const r of rows) {
      const list = out.get(r.nodeId)
      if (list) list.push(r)
      else out.set(r.nodeId, [r])
    }
    return (nodeId: string) => out.get(nodeId) ?? []
  }
  const [critOf, reqOf, resOf, obsOf, msgOf] = [group(criteria), group(requirements), group(resourceRows), group(obstacles), group(messages)]
  const plan = {
    ...row,
    nodes: nodeRows.map((n) => ({
      ...n,
      criteria: critOf(n.id),
      requirements: reqOf(n.id).map((r) => ({ ...r, provider: { ref: refOf.get(r.providerId)! } })),
      resources: resOf(n.id),
      obstacles: obsOf(n.id),
      messages: msgOf(n.id),
    })),
  }

  const byRef = new Map(plan.nodes.map((n) => [n.ref, n]))
  const bySeq = (a: string, b: string) => byRef.get(a)!.seq - byRef.get(b)!.seq
  const prereqs = new Map(
    plan.nodes.map((n) => [n.ref, [...new Set(n.requirements.map((r) => r.provider.ref))].sort(bySeq)] as const),
  )
  const enables = new Map<string, string[]>(plan.nodes.map((n) => [n.ref, []]))
  for (const [later, formers] of prereqs) for (const former of formers) enables.get(former)!.push(later)

  const loops = findLoops(prereqs)
  const inLoop = new Set(loops)

  // What a node measures its gap against: its measured providers, seen through milestones.
  const measuredMemo = new Map<string, { ref: string; level: number }[]>()
  const measured = (ref: string): { ref: string; level: number }[] => {
    const known = measuredMemo.get(ref)
    if (known) return known
    measuredMemo.set(ref, [])
    const found = new Map<string, { ref: string; level: number }>()
    for (const p of prereqs.get(ref) ?? []) {
      const provider = byRef.get(p)!
      if (provider.level !== null) found.set(p, { ref: p, level: provider.level })
      else for (const m of measured(p)) found.set(m.ref, m)
    }
    const list = [...found.values()].sort((a, b) => bySeq(a.ref, b.ref))
    measuredMemo.set(ref, list)
    return list
  }

  // Earliest dates. A done node is finished; the others start once what they require is.
  const today = isoDay(new Date())
  const planStart = plan.start ? isoDay(plan.start) : today
  const begin = planStart > today ? planStart : today
  const schedMemo = new Map<string, Schedule>()
  const schedule = (ref: string): Schedule => {
    const known = schedMemo.get(ref)
    if (known) return known
    const unknown: Schedule = { start: null, finish: null }
    schedMemo.set(ref, unknown)
    const n = byRef.get(ref)!
    if (n.status === "done" || inLoop.has(ref)) {
      const result = n.status === "done" ? { start: null, finish: begin } : unknown
      schedMemo.set(ref, result)
      return result
    }
    let start: string | null = begin
    for (const p of prereqs.get(ref) ?? []) {
      const finish = schedule(p).finish
      if (finish === null) start = null
      else if (start !== null && finish > start) start = finish
    }
    const finish = start !== null && n.duration !== null ? addDays(start, n.duration) : null
    const result = { start, finish }
    schedMemo.set(ref, result)
    return result
  }

  // Fill the memos providers first: each call then finds its providers known, so no deep recursion on long chains.
  const depth = depths(prereqs)
  const upward = [...prereqs.keys()].sort((a, b) => depth.get(a)! - depth.get(b)!)
  for (const ref of upward) {
    measured(ref)
    schedule(ref)
  }

  const nodes: NodeView[] = plan.nodes.map((n) => {
    const deps = prereqs.get(n.ref)!
    const done = (ref: string) => byRef.get(ref)!.status === "done"
    return {
      plan: plan.slug,
      ref: n.ref,
      seq: n.seq,
      title: n.title,
      description: n.description,
      level: n.level,
      status: n.status,
      size: n.size,
      duration: n.duration,
      due: n.due ? isoDay(n.due) : null,
      schedule: schedule(n.ref),
      ready: n.status !== "done" && deps.every(done) && planStart <= today,
      criteria: n.criteria.map((c) => ({ slug: c.slug, text: c.text, met: c.met })),
      requirements: n.requirements.map((r) => ({
        slug: r.slug,
        text: r.text,
        met: done(r.provider.ref),
        providedBy: r.provider.ref,
      })),
      resources: n.resources.map((r) => ({
        slug: r.slug,
        kind: r.kind,
        name: r.name,
        quantity: r.quantity,
        unit: r.unit,
        provides: r.provides,
      })),
      obstacles: n.obstacles.map((o) => ({ slug: o.slug, text: o.text, fix: o.fix, status: o.status })),
      dependsOn: deps,
      enables: enables.get(n.ref)!.sort(bySeq),
      gap: n.level === null ? null : computeGap(n.level, measured(n.ref), plan),
      messages: n.messages.map((m) => ({
        id: m.handle,
        author: m.author,
        text: m.text,
        at: m.createdAt.toISOString(),
        edited: m.editedAt !== null,
      })),
    }
  })

  // A provider must not be beyond the node it provides for (both measured).
  const dir = direction(plan)
  const misordered: [string, string][] = []
  for (const n of nodes) {
    if (n.level === null) continue
    for (const p of n.dependsOn) {
      const level = byRef.get(p)!.level
      if (level !== null && dir * (level - n.level) > 1e-9) misordered.push([n.ref, p])
    }
  }

  // Cash: what a node and everything it requires spend, against what its ancestors bring in plus the plan's cash.
  const unit = plan.cashUnit.trim().toLowerCase()
  const cashOf = (ref: string, provides: boolean) =>
    byRef
      .get(ref)!
      .resources.filter((r) => r.provides === provides && r.unit.trim().toLowerCase() === unit)
      .reduce((sum, r) => sum + r.quantity, 0)
  const unfunded = new Map<string, number>()
  // A plan tracks cash once it has some at the start or a node brings some in; before that, no check.
  const tracksCash = plan.cash > 0 || nodes.some((n) => cashOf(n.ref, true) > 0)
  for (const n of tracksCash ? nodes : []) {
    if (inLoop.has(n.ref)) continue
    const ancestors = ancestorsOf(prereqs, n.ref)
    let spent = cashOf(n.ref, false)
    let brought = plan.cash
    for (const a of ancestors) {
      spent += cashOf(a, false)
      brought += cashOf(a, true)
    }
    if (spent - brought > 1e-9) unfunded.set(n.ref, Math.round((spent - brought) * 100) / 100)
  }

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

  return {
    ...summarise(plan, nodes.length),
    nodes,
    resources,
    check: checkPlan(plan, nodes, { loops, misordered, unfunded, cashUnit: plan.cashUnit }),
  }
}

/** YYYY-MM-DD of a date, in UTC. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** A YYYY-MM-DD date plus a number of days (rounded up). */
export function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.ceil(days))
  return isoDay(d)
}

/** Every node `ref` requires, directly or not (itself only when caught in a loop). */
function ancestorsOf(prereqs: ReadonlyMap<string, readonly string[]>, ref: string) {
  const seen = new Set<string>()
  const stack = [...(prereqs.get(ref) ?? [])]
  while (stack.length) {
    const current = stack.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(prereqs.get(current) ?? []))
  }
  return seen
}

/**
 * Refs that require themselves: members of a strongly connected component of
 * more than one node, or with a link to itself. The engine refuses such links;
 * this catches old data. Iterative Tarjan: linear, no deep recursion.
 */
export function findLoops(prereqs: ReadonlyMap<string, readonly string[]>): string[] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const loops: string[] = []
  let counter = 0
  for (const root of prereqs.keys()) {
    if (index.has(root)) continue
    const work: [string, number][] = [[root, 0]]
    index.set(root, counter)
    low.set(root, counter++)
    stack.push(root)
    onStack.add(root)
    while (work.length) {
      const top = work[work.length - 1]!
      const [node, i] = top
      const next = prereqs.get(node) ?? []
      if (i < next.length) {
        top[1] = i + 1
        const p = next[i]!
        if (!index.has(p)) {
          index.set(p, counter)
          low.set(p, counter++)
          stack.push(p)
          onStack.add(p)
          work.push([p, 0])
        } else if (onStack.has(p)) low.set(node, Math.min(low.get(node)!, index.get(p)!))
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1]![0]
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!))
      }
      if (low.get(node) === index.get(node)) {
        const component: string[] = []
        let member: string
        do {
          member = stack.pop()!
          onStack.delete(member)
          component.push(member)
        } while (member !== node)
        if (component.length > 1 || next.includes(node)) loops.push(...component)
      }
    }
  }
  const order = [...prereqs.keys()]
  return loops.sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

export async function loadNode(planSlug: string, ref: string): Promise<NodeView> {
  const plan = await loadPlan(planSlug)
  const node = plan.nodes.find((n) => n.ref === normRef(ref))
  if (!node) throw new OpError(`No node ${normRef(ref)} in plan "${plan.slug}".`, "not_found")
  return node
}

export { summariseNode }

/** The default and largest page of nodes. */
export const PAGE = 50
export const MAX_PAGE = 500

export interface PageOptions {
  status?: NodeStatus | undefined
  /** Only the nodes that can start today. */
  ready?: boolean | undefined
  /** Only the nodes after this ref, in ref order. */
  after?: string | undefined
  limit?: number | undefined
}

/** A page of the nodes of a plan, in ref order. Paged by ref, never by position. */
export function pageNodes(plan: PlanView, { status, ready, after, limit = PAGE }: PageOptions): NodePage {
  const matching = plan.nodes.filter(
    (n) => (status === undefined || n.status === status) && (ready === undefined || n.ready === ready),
  )
  let from = 0
  if (after !== undefined) {
    const cursor = plan.nodes.find((n) => n.ref === normRef(after))
    if (!cursor) throw new OpError(`No node ${normRef(after)} in plan "${plan.slug}".`, "not_found")
    from = matching.filter((n) => n.seq <= cursor.seq).length
  }
  const page = matching.slice(from, from + limit)
  const more = from + page.length < matching.length
  return {
    plan: plan.slug,
    total: matching.length,
    nodes: page.map(summariseNode),
    next: more ? page.at(-1)!.ref : null,
  }
}

/** The plan in compact form for the graph view (`plan graph`). */
export function graphOf(plan: PlanView): PlanGraph {
  const errors = plan.check.issues.filter((i) => i.severity === "error").length
  return {
    ...summarise(plan, plan.nodes.length),
    check: { ok: plan.check.ok, errors, warnings: plan.check.issues.length - errors },
    nodes: plan.nodes.map((n) => ({
      ref: n.ref,
      seq: n.seq,
      title: n.title,
      level: n.level,
      status: n.status,
      size: n.size,
      gap: n.gap,
      finish: n.schedule.finish,
      due: n.due,
      ready: n.ready,
      dependsOn: n.dependsOn,
      criteria: { total: n.criteria.length, met: n.criteria.filter((c) => c.met).length },
      obstacles: n.obstacles.filter((o) => o.status === "open").length,
    })),
  }
}

/** The plan in a bounded size: its fields, the check as counts, and the first page of nodes. */
export function briefOf(plan: PlanView, options: PageOptions = {}): PlanBrief {
  const errors = plan.check.issues.filter((i) => i.severity === "error").length
  return {
    ...summarise(plan, plan.nodes.length),
    check: { ok: plan.check.ok, errors, warnings: plan.check.issues.length - errors },
    nodes: pageNodes(plan, options),
  }
}
