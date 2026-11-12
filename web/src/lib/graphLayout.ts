/**
 * Where the nodes of a plan go on the graph view. Pure: no React, no DOM.
 *
 * The plan reads left to right, from the present to the target. A node's
 * column is how many steps are left after it, by the longest way, so what a
 * node requires sits just before it. Rows are filled from the target side: a
 * node goes next to what it makes possible.
 *
 * A link between neighbouring columns is a curve. A link that jumps over
 * columns runs in a lane between two rows, so it never passes under a card.
 */
import { depths, reducedLinks } from "@engine/graph.ts"
import type { GraphNode, PlanGraph } from "@engine/types.ts"

const CARD = { w: 216, h: 112 }
const MARK = { w: 128, h: 52 }
const PAD = 20
const COL_GAP = 64
const ROW_GAP = 20
const LANE_PAD = 12
const LANE_STEP = 10
const CORNER = 8
const ARROW = 5

export const PRESENT = "present"
export const TARGET = "target"

export interface GraphItem {
  /** A node ref, or PRESENT or TARGET for the two ends of the plan. */
  id: string
  node: GraphNode | null
  x: number
  y: number
  w: number
  h: number
}

export interface GraphEdge {
  id: string
  /** The former item, on the left. */
  from: string
  /** The later item, on the right. */
  to: string
  /** SVG path of the link. */
  d: string
  /** SVG path of the arrow head, at the later item. */
  arrow: string
  /** True for the links to the two ends of the plan. */
  dashed: boolean
  /** Bounding box of the drawn link, to draw only the links in view. */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface GraphLayout {
  width: number
  height: number
  /** Left to right, then top to bottom. */
  items: GraphItem[]
  edges: GraphEdge[]
}

type Point = readonly [number, number]

/** A line through the points, with its corners rounded. */
function rounded(points: Point[]): string {
  const [x0, y0] = points[0]!
  const parts = [`M ${x0} ${y0}`]
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!
    const [cx, cy] = points[i]!
    const [nx, ny] = points[i + 1]!
    const before = Math.hypot(cx - px, cy - py)
    const after = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(CORNER, before / 2, after / 2)
    if (r === 0) continue
    parts.push(
      `L ${cx + ((px - cx) / before) * r} ${cy + ((py - cy) / before) * r}`,
      `Q ${cx} ${cy} ${cx + ((nx - cx) / after) * r} ${cy + ((ny - cy) / after) * r}`,
    )
  }
  const [xn, yn] = points.at(-1)!
  parts.push(`L ${xn} ${yn}`)
  return parts.join(" ")
}

export function layoutGraph(plan: PlanGraph): GraphLayout {
  const nodes = new Map(plan.nodes.map((n) => [n.ref, n]))
  const dir = plan.targetValue >= plan.presentValue ? 1 : -1
  // Same test as the engine's check (rules.ts): the node reaches the target value.
  const atTarget = (n: GraphNode) => n.level !== null && dir * (n.level - plan.targetValue) >= -1e-9

  /** What each item leads to, without the links implied by a longer path. */
  const reduced = reducedLinks(new Map(plan.nodes.map((n) => [n.ref, n.dependsOn])))
  const later = new Map<string, string[]>([
    [TARGET, []],
    [PRESENT, plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.ref)],
  ])
  for (const n of plan.nodes) later.set(n.ref, atTarget(n) ? [TARGET] : [])
  for (const [former, next] of reduced) if (nodes.has(next)) later.get(former)?.unshift(next)
  const ids = [PRESENT, ...plan.nodes.map((n) => n.ref), TARGET]

  // Steps left after each item, by the longest way: the depth of the graph read forward.
  // Iterative (graph.ts), so long chains never overflow the stack; loops (refused by the engine) get 0.
  const steps = depths(later)
  const stepsOf = (id: string) => steps.get(id) ?? 0
  let last = 1
  for (const id of ids) last = Math.max(last, stepsOf(id))
  const col = new Map(ids.map((id) => [id, id === PRESENT ? 0 : last - stepsOf(id)]))
  const columns: string[][] = Array.from({ length: last + 1 }, () => [])
  for (const id of ids) columns[col.get(id)!]!.push(id)

  // Rows, from the target side: each item next to what it leads to.
  const row = new Map<string, number>()
  const seq = (id: string) => (id === TARGET ? -1 : (nodes.get(id)?.seq ?? 0))
  for (let c = last; c >= 0; c--) {
    const wanted = new Map(
      columns[c]!.map((id) => {
        const rows = (later.get(id) ?? []).map((next) => row.get(next)).filter((r): r is number => r !== undefined)
        return [id, rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Infinity] as const
      }),
    )
    const sorted = [...columns[c]!].sort((a, b) => wanted.get(a)! - wanted.get(b)! || seq(a) - seq(b))
    let free = 0
    for (const id of sorted) {
      const want = wanted.get(id)!
      const r = Math.max(free, Number.isFinite(want) ? Math.round(want) : free)
      row.set(id, r)
      free = r + 1
    }
  }
  let rowCount = 1
  for (const r of row.values()) rowCount = Math.max(rowCount, r + 1)

  // Columns are as wide as their widest item.
  const size = (id: string) => (nodes.has(id) ? CARD : MARK)
  const colW = columns.map((list) => list.reduce((w, id) => Math.max(w, size(id).w), 0))
  const colX: number[] = []
  let x = PAD
  for (const w of colW) {
    colX.push(x)
    x += w + COL_GAP
  }
  const width = x - COL_GAP + PAD

  // Links, and the lane of those that jump over a column.
  const taken = new Set(ids.map((id) => `${col.get(id)}:${row.get(id)}`))
  const links = ids.flatMap((from) =>
    (later.get(from) ?? []).map((to) => {
      const cu = col.get(from)!
      const cv = col.get(to)!
      const ru = row.get(from)!
      const rv = row.get(to)!
      let clear = ru === rv
      for (let c = cu + 1; clear && c < cv; c++) clear = !taken.has(`${c}:${ru}`)
      return {
        from,
        to,
        /** "curve" to a neighbour, "line" through free cells, "lane" around the cards. */
        kind: cv - cu === 1 ? "curve" : clear ? "line" : "lane",
        /** The lane runs above this row. */
        above: Math.max(ru, rv),
        lane: 0,
        // Where the link turns, in the gaps after its first column and before its last.
        xa: colX[cu]! + colW[cu]! + 14 + (ru % 3) * 6,
        xb: colX[cv]! - 14 - (rv % 3) * 6,
      }
    }),
  )
  const lanes: number[] = Array.from({ length: rowCount }, () => 0)
  const byRow: (typeof links)[] = Array.from({ length: rowCount }, () => [])
  for (const link of links) if (link.kind === "lane") byRow[link.above]!.push(link)
  for (let r = 0; r < rowCount; r++) {
    const ends: number[] = []
    for (const link of byRow[r]!.sort((a, b) => a.xa - b.xa)) {
      const reuse = ends.findIndex((end) => end + 8 < link.xa)
      link.lane = reuse === -1 ? ends.length : reuse
      ends[link.lane] = link.xb
    }
    lanes[r] = ends.length
  }

  // Rows are a card high; the gap above a row grows with its lanes.
  const rowY: number[] = []
  let y = 0
  for (let r = 0; r < rowCount; r++) {
    const n = lanes[r]!
    y += (r === 0 ? PAD : ROW_GAP) + (n ? LANE_PAD * 2 + (n - 1) * LANE_STEP : 0)
    rowY.push(y)
    y += CARD.h
  }
  const height = y + PAD

  const box = new Map(
    ids.map((id) => {
      const { w, h } = size(id)
      return [id, { x: colX[col.get(id)!]!, y: rowY[row.get(id)!]! + (CARD.h - h) / 2, w, h }] as const
    }),
  )

  const edges: GraphEdge[] = links.map((link) => {
    const u = box.get(link.from)!
    const v = box.get(link.to)!
    const ax = u.x + u.w
    const ay = u.y + u.h / 2
    const bx = v.x
    const by = v.y + v.h / 2
    let d: string
    let top = Math.min(ay, by)
    let bottom = Math.max(ay, by)
    if (link.kind === "curve") {
      const mid = (ax + bx) / 2
      d = `M ${ax} ${ay} C ${mid} ${ay} ${mid} ${by} ${bx} ${by}`
    } else if (link.kind === "line") {
      d = `M ${ax} ${ay} L ${bx} ${by}`
    } else {
      const ly = rowY[link.above]! - LANE_PAD - link.lane * LANE_STEP
      top = Math.min(top, ly)
      bottom = Math.max(bottom, ly)
      d = rounded([
        [ax, ay],
        [link.xa, ay],
        [link.xa, ly],
        [link.xb, ly],
        [link.xb, by],
        [bx, by],
      ])
    }
    return {
      id: `${link.from}>${link.to}`,
      from: link.from,
      to: link.to,
      d,
      arrow: `M ${bx - ARROW} ${by - ARROW} L ${bx} ${by} L ${bx - ARROW} ${by + ARROW}`,
      dashed: link.from === PRESENT || link.to === TARGET,
      x0: ax,
      y0: top - ARROW,
      x1: bx,
      y1: bottom + ARROW,
    }
  })

  const items: GraphItem[] = ids
    .map((id) => ({ id, node: nodes.get(id) ?? null, ...box.get(id)! }))
    .sort((a, b) => a.x - b.x || a.y - b.y)

  return { width, height, items, edges }
}
