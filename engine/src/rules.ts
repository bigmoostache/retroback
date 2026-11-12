/**
 * The rules of backward planning. Pure functions, no database.
 *
 * A plan moves one metric from its present value to its target value. Each
 * node states the level reached once it is done. A node starts from the most
 * advanced node it depends on, or from the present when it depends on nothing.
 * That step must be positive and no larger than the plan's gap (the 1% rule).
 */
import { OpError } from "./ops/define.ts"
import type { CheckView, Gap, Issue, NodeView } from "./types.ts"

const EPS = 1e-9

export interface Scale {
  presentValue: number
  targetValue: number
  gapPercent: number
}

interface Level {
  ref: string
  level: number
}

/** +1 when the metric must grow, -1 when it must shrink. */
export const direction = (plan: Pick<Scale, "presentValue" | "targetValue">) => (plan.targetValue >= plan.presentValue ? 1 : -1)

const progress = (plan: Scale, from: number, to: number) =>
  from === 0 ? null : ((direction(plan) * (to - from)) / Math.abs(from)) * 100

export function computeGap(level: number, dependsOn: Level[], plan: Scale): Gap {
  const dir = direction(plan)
  let from = "present"
  let base = plan.presentValue
  dependsOn.forEach((dep, i) => {
    if (i === 0 || dir * (dep.level - base) > 0) {
      from = dep.ref
      base = dep.level
    }
  })
  const raw = progress(plan, base, level)
  return {
    from,
    base,
    percent: raw === null ? null : Math.round(raw * 1e4) / 1e4,
    ok: raw !== null && raw > 0 && raw <= plan.gapPercent + EPS,
  }
}

function roundSig(x: number, digits: number, round: (n: number) => number) {
  if (x === 0) return 0
  const scale = 10 ** (digits - 1 - Math.floor(Math.log10(Math.abs(x))))
  return Number((round(x * scale) / scale).toPrecision(12))
}

/**
 * Level of a new node placed one full step before `enabled`: as far back as
 * the gap allows, so the chain reaches the present in the fewest nodes.
 */
export function prerequisiteLevel(plan: Scale, enabled: Level[]): number {
  const dir = direction(plan)
  const tight = enabled.reduce((a, b) => (dir * (b.level - a.level) < 0 ? b : a))
  const toPresent = progress(plan, plan.presentValue, tight.level)
  if (toPresent !== null && toPresent <= plan.gapPercent + EPS) {
    throw new OpError(
      `${tight.ref} is within ${plan.gapPercent}% of the present value (${plan.presentValue}): the chain already reaches now. Pass --level to add a node anyway.`,
    )
  }
  const exact = tight.level / (1 + (dir * plan.gapPercent) / 100)
  const rounded = roundSig(exact, 4, dir > 0 ? Math.ceil : Math.floor)
  return rounded === tight.level ? exact : rounded
}

/** Does `from` depend, directly or not, on `to`? Edges are [node, dependsOn]. */
export function dependsOnPath(edges: (readonly [string, string])[], from: string, to: string) {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const current = stack.pop()!
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const [node, dep] of edges) if (node === current) stack.push(dep)
  }
  return false
}

/** Extra facts the check needs beyond the nodes: computed in views.ts. */
export interface CheckExtras {
  /** Refs caught in a requirement loop. */
  loops: string[]
  /** [node, provider] pairs where the provider's level is beyond the node's. */
  misordered: [string, string][]
  /** Per node ref: cash short, in the plan's cash unit, when spending outruns what came in. */
  unfunded: Map<string, number>
  cashUnit: string
}

export function checkPlan(plan: Scale & { slug: string }, nodes: NodeView[], extras?: CheckExtras): CheckView {
  const issues: Issue[] = []
  const add = (severity: Issue["severity"], code: string, node: string | null, message: string) =>
    issues.push({ severity, code, node, message })
  const dir = direction(plan)
  const atTarget = (n: NodeView) => n.level !== null && dir * (n.level - plan.targetValue) >= -EPS

  if (nodes.length === 0) add("error", "empty", null, "The plan has no node. Create the target first.")
  else if (!nodes.some(atTarget)) {
    add("error", "target_missing", null, `No node reaches the target value ${plan.targetValue}.`)
  }

  for (const ref of extras?.loops ?? []) {
    add("error", "loop", ref, `${ref} requires itself through a loop of requirements. Remove one of the links.`)
  }
  for (const [node, provider] of extras?.misordered ?? []) {
    add("error", "provider_beyond", node, `${provider} provides a requirement of ${node} but its level is beyond ${node}'s.`)
  }

  for (const n of nodes) {
    const short = extras?.unfunded.get(n.ref)
    if (short !== undefined) {
      add("error", "unfunded", n.ref, `${n.ref} and what it requires spend ${short} ${extras!.cashUnit} more than the plan has by then.`)
    }
    if (n.due && n.schedule.finish && n.schedule.finish > n.due) {
      add("error", "late", n.ref, `${n.ref} finishes ${n.schedule.finish} at the earliest, after its due date ${n.due}.`)
    }
    if (n.status !== "done" && n.obstacles.length === 0) {
      add("warning", "no_obstacles", n.ref, `${n.ref} lists no obstacle: what could stop it?`)
    }
    if (n.criteria.length === 0) add("error", "no_criteria", n.ref, `${n.ref} has no success criterion.`)
    for (const c of n.criteria) {
      if (!/\d/.test(c.text)) {
        add(
          "warning",
          "vague_criterion",
          n.ref,
          `${n.ref} criterion "${c.slug}" has no figure: state a number, a date or a threshold.`,
        )
      }
    }
    if (n.resources.length === 0) add("warning", "no_resources", n.ref, `${n.ref} needs no resource.`)
    if (n.enables.length === 0 && !atTarget(n)) {
      add("warning", "leads_nowhere", n.ref, `${n.ref} enables no later node and is not the target.`)
    }

    // A milestone moves no metric: no gap to check.
    const { gap } = n
    if (gap === null || n.level === null) continue
    const from = gap.from === "present" ? `the present (${gap.base})` : `${gap.from} (${gap.base})`
    if (gap.percent === null) {
      add("error", "gap_undefined", n.ref, `${n.ref} starts from 0: a percent gap cannot be computed.`)
    } else if (gap.percent <= 0) {
      add("error", "no_progress", n.ref, `${n.ref} (${n.level}) is not beyond ${from}.`)
    } else if (!gap.ok) {
      add(
        "error",
        "gap_too_large",
        n.ref,
        `${n.ref} (${n.level}) is ${gap.percent}% beyond ${from}; the plan allows ${plan.gapPercent}%. Add a node in between.`,
      )
    }
  }

  return { plan: plan.slug, ok: !issues.some((i) => i.severity === "error"), issues }
}
