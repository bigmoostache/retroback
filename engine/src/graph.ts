/**
 * The graph of a plan, read from its requirements. Pure, no import: the web
 * app uses it too.
 *
 * A node X requires a node P when P provides one of X's requirements. These
 * links always go from a former node to a later one, and never loop (a DAG).
 */

/** For each node ref, the refs of the nodes it requires. */
export type Prereqs = ReadonlyMap<string, readonly string[]>

interface Unlockable {
  ref: string
  seq: number
  status: string
}

/** Can `to` be reached from `from` by going down the requirements? */
export function requires(prereqs: Prereqs, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const current = stack.pop()!
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(prereqs.get(current) ?? []))
  }
  return false
}

/**
 * What to tackle now to reach `ref`: the nodes not done yet, among `ref` and
 * everything it requires, whose own requirements are all done. Nothing past a
 * done node is visited. Empty when `ref` is done. Sorted by ref number.
 */
export function unlock<N extends Unlockable>(nodes: readonly N[], prereqs: Prereqs, ref: string): N[] {
  const byRef = new Map(nodes.map((n) => [n.ref, n]))
  const found = new Map<string, N>()
  const seen = new Set<string>()
  const visit = (current: string) => {
    if (seen.has(current)) return
    seen.add(current)
    const node = byRef.get(current)
    if (!node || node.status === "done") return
    const open = (prereqs.get(current) ?? []).filter((p) => byRef.get(p)?.status !== "done")
    if (open.length === 0) found.set(current, node)
    else open.forEach(visit)
  }
  visit(ref)
  return [...found.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * The nodes still in the way to `ref`: it and everything it requires that is
 * not done, stopping at done nodes. `unlock` returns the deepest of them.
 */
export function openPath<N extends Unlockable>(nodes: readonly N[], prereqs: Prereqs, ref: string): Set<string> {
  const byRef = new Map(nodes.map((n) => [n.ref, n]))
  const path = new Set<string>()
  const stack = [ref]
  while (stack.length) {
    const current = stack.pop()!
    if (path.has(current) || !byRef.has(current) || byRef.get(current)!.status === "done") continue
    path.add(current)
    stack.push(...(prereqs.get(current) ?? []))
  }
  return path
}

/**
 * The size of reaching `ref`: the heaviest path through the nodes still in
 * the way (`openPath`), summing their sizes. With perfect parallelism, that is
 * how much is left before `ref` is done. 0 when `ref` is done.
 */
export function unlockSize<N extends Unlockable & { size: number }>(nodes: readonly N[], prereqs: Prereqs, ref: string): number {
  const byRef = new Map(nodes.map((n) => [n.ref, n]))
  const open = openPath(nodes, prereqs, ref)
  const memo = new Map<string, number>()
  const heaviest = (current: string): number => {
    const known = memo.get(current)
    if (known !== undefined) return known
    // Guard against a loop the engine never lets in.
    memo.set(current, 0)
    const before = (prereqs.get(current) ?? []).filter((p) => open.has(p)).map(heaviest)
    const value = byRef.get(current)!.size + Math.max(0, ...before)
    memo.set(current, value)
    return value
  }
  return open.has(ref) ? heaviest(ref) : 0
}

/**
 * The links worth drawing: [former, later] pairs, without those implied by a
 * longer path (if A requires B and C, and B requires C, C -> A is dropped).
 */
export function reducedLinks(prereqs: Prereqs): [string, string][] {
  const depth = depths(prereqs)
  const links: [string, string][] = []
  for (const [later, direct] of prereqs) {
    if (direct.length < 2) {
      for (const former of direct) links.push([former, later])
      continue
    }
    // One walk down from the providers' own requirements: a direct provider met on the way is implied.
    // A node no deeper than the shallowest provider cannot lead to any of them: the walk stops there.
    const floor = Math.min(...direct.map((d) => depth.get(d) ?? 0))
    const wanted = new Set(direct)
    const implied = new Set<string>()
    const seen = new Set<string>()
    const stack = direct.flatMap((d) => [...(prereqs.get(d) ?? [])])
    while (stack.length) {
      const current = stack.pop()!
      if (seen.has(current)) continue
      seen.add(current)
      if (wanted.has(current)) implied.add(current)
      if ((depth.get(current) ?? 0) <= floor) continue
      for (const p of prereqs.get(current) ?? []) stack.push(p)
    }
    for (const former of direct) if (!implied.has(former)) links.push([former, later])
  }
  return links
}

/**
 * For each node, the length of the longest chain of requirements below it
 * (0 for a node that requires nothing). Iterative: no deep recursion on long
 * chains. A node caught in a loop (the engine refuses those) gets 0.
 */
export function depths(prereqs: Prereqs): Map<string, number> {
  const depth = new Map<string, number>()
  const state = new Map<string, 1 | 2>() // 1: on the stack, 2: done
  for (const root of prereqs.keys()) {
    if (state.has(root)) continue
    const stack: [string, number][] = [[root, 0]]
    state.set(root, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]!
      const [node, i] = top
      const list = prereqs.get(node) ?? []
      if (i < list.length) {
        top[1] = i + 1
        const next = list[i]!
        if (!state.has(next)) {
          state.set(next, 1)
          stack.push([next, 0])
        }
        continue
      }
      let d = 0
      for (const p of list) if (state.get(p) === 2) d = Math.max(d, (depth.get(p) ?? 0) + 1)
      depth.set(node, d)
      state.set(node, 2)
      stack.pop()
    }
  }
  return depth
}
