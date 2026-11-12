import { useEffect, useMemo, useRef, type ReactNode, type WheelEvent } from "react"
import { Flag, LockOpen, MapPin, Plus } from "lucide-react"
import { openPath, unlock } from "@engine/graph.ts"
import type { NodeView, PlanView } from "@engine/types.ts"
import { PanelHeader } from "@/components/plan/PanelHeader"
import { StatusBadge } from "@/components/plan/StatusBadge"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tip"
import { toCommand } from "@/lib/api"
import { gapText, num } from "@/lib/format"
import { layoutGraph, PRESENT, type GraphItem } from "@/lib/graphLayout"
import { nodeCreate, type Ask } from "@/lib/requests"
import { cn, prefersReducedMotion } from "@/lib/utils"

const place = (item: GraphItem) => ({ left: item.x, top: item.y, width: item.w, height: item.h })

/** One end of the plan: the present on the left, the target on the right. */
function End({ item, plan }: { item: GraphItem; plan: PlanView }) {
  const present = item.id === PRESENT
  const Icon = present ? MapPin : Flag
  return (
    <div
      data-marker={item.id}
      style={place(item)}
      className="absolute flex flex-col justify-center gap-0.5 rounded-xl border border-dashed border-(--border-strong) px-3 text-subhead text-muted-foreground"
    >
      <span className="flex items-center gap-1">
        <Icon className="size-3 shrink-0" />
        {present ? "Present" : "Target"}
      </span>
      <span className="truncate font-mono text-foreground tabular-nums">
        {num(present ? plan.presentValue : plan.targetValue)} {plan.unit}
      </span>
    </div>
  )
}

/** How a card stands in the unlock view: to tackle now, still in the way, or out of it. */
type Mark = "now" | "path" | "dim" | null

function Card({
  item,
  node,
  selected,
  mark,
  onSelect,
}: {
  item: GraphItem
  node: NodeView
  selected: boolean
  mark: Mark
  onSelect: (ref: string) => void
}) {
  const met = node.criteria.filter((c) => c.met).length
  return (
    <button
      type="button"
      data-node-ref={node.ref}
      data-unlock-mark={mark ?? undefined}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(node.ref)}
      style={place(item)}
      className={cn(
        "card-shadow absolute flex cursor-pointer flex-col gap-1 overflow-hidden rounded-2xl bg-surface-2 p-3 text-left transition-opacity duration-base",
        selected && "outline-2 outline-offset-2 outline-interactive",
        mark === "now" && "outline-2 outline-offset-2 outline-(--signal)",
        mark === "dim" && "opacity-35",
      )}
    >
      <span className="flex h-5 shrink-0 items-center gap-2">
        <code className="font-mono text-subhead text-muted-foreground">{node.ref}</code>
        <StatusBadge status={node.status} />
        {mark === "now" && (
          <span className="rounded-sm bg-(--signal) px-1.5 text-caption font-medium text-(--primary-foreground)">now</span>
        )}
        <span className="ml-auto font-mono text-subhead text-foreground tabular-nums">{num(node.level)}</span>
      </span>
      <span className="line-clamp-2 text-body leading-5 font-medium text-foreground/90">{node.title}</span>
      <span className="mt-auto flex h-5 shrink-0 items-center gap-2 text-subhead">
        <span className={cn("font-mono tabular-nums", node.gap.ok ? "text-ok" : "text-danger")}>
          {gapText(node.gap)}
        </span>
        <span title="Size, 0 to 100" className="font-mono text-muted-foreground tabular-nums">
          s{node.size}
        </span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {met}/{node.criteria.length} criteria
        </span>
      </span>
    </button>
  )
}

/**
 * The plan as a graph, read left to right from the present to the target.
 * A link goes from a node to the later node it makes possible. Same data as
 * the list (`rb node list`); a click selects the node shown in the detail.
 */
export function NodeGraph({
  plan,
  selected,
  onSelect,
  ask,
  tools,
  unlockOf,
  onUnlock,
}: {
  plan: PlanView
  selected: string | null
  onSelect: (ref: string) => void
  ask: Ask
  tools?: ReactNode | undefined
  /** The node whose unlock is shown on the graph, or null. */
  unlockOf: string | null
  onUnlock: (ref: string | null) => void
}) {
  const layout = useMemo(() => layoutGraph(plan), [plan])
  const scroller = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  const created = (result: unknown) => onSelect((result as NodeView).ref)
  const current = plan.nodes.find((n) => n.ref === selected) ?? null
  const shown = layout.items.find((item) => item.id === selected)
  const left = shown?.x
  const wide = shown?.w

  // Same answer as `rb node unlock`: both run graph.ts on the same links.
  const unlocking = useMemo(() => {
    if (!unlockOf || !plan.nodes.some((n) => n.ref === unlockOf)) return null
    const prereqs = new Map(plan.nodes.map((n) => [n.ref, n.dependsOn]))
    return {
      now: new Set(unlock(plan.nodes, prereqs, unlockOf).map((n) => n.ref)),
      path: openPath(plan.nodes, prereqs, unlockOf),
    }
  }, [plan, unlockOf])
  const markOf = (ref: string): Mark =>
    !unlocking ? null : unlocking.now.has(ref) ? "now" : unlocking.path.has(ref) ? "path" : "dim"

  // Keep the selected node in sight: centred at first, then moved only when it is out of view.
  useEffect(() => {
    const el = scroller.current
    if (!el || left === undefined || wide === undefined) return
    const initial = first.current
    first.current = false
    const margin = 32
    let to: number | null = null
    if (initial) to = left + wide / 2 - el.clientWidth / 2
    else if (left < el.scrollLeft + margin) to = left - margin
    else if (left + wide > el.scrollLeft + el.clientWidth - margin) to = left + wide + margin - el.clientWidth
    if (to === null) return
    el.scrollTo({ left: Math.max(0, to), behavior: initial || prefersReducedMotion() ? "auto" : "smooth" })
  }, [selected, left, wide])

  // A mouse wheel moves along the plan when there is nothing to scroll vertically.
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
    if (el.scrollHeight > el.clientHeight) return
    el.scrollLeft += event.deltaY
  }

  const onPath = (edge: { from: string; to: string }) =>
    unlocking !== null && unlocking.path.has(edge.from) && unlocking.path.has(edge.to)
  const touches = (edge: { from: string; to: string }) =>
    unlocking ? onPath(edge) : edge.from === selected || edge.to === selected
  // The links of the selected node are drawn last, above the others.
  const edges = [...layout.edges].sort((a, b) => Number(touches(a)) - Number(touches(b)))

  return (
    <section className="card-shadow flex shrink-0 flex-col rounded-2xl bg-surface-2">
      <PanelHeader
        title="Nodes"
        note="from the present to the target"
        command={toCommand("node.list", { plan: plan.slug })}
      >
        {tools}
        {current && (
          <Tip
            title={unlockOf === current.ref ? "Hide the unlock" : `What to tackle now to reach ${current.ref}`}
            body={<code className="font-mono">rb node unlock --ref {current.ref}</code>}
            tabbable={false}
            triggerClassName="flex shrink-0"
          >
            <Button
              variant={unlockOf === current.ref ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={unlockOf === current.ref}
              data-unlock-toggle
              onClick={() => onUnlock(unlockOf === current.ref ? null : current.ref)}
            >
              <LockOpen />
              Unlock {current.ref}
              {unlocking && unlockOf === current.ref && (
                <span className="font-mono tabular-nums text-muted-foreground">{unlocking.now.size}</span>
              )}
            </Button>
          </Tip>
        )}
        {current && (
          <Tip
            title={`Add the node before ${current.ref}`}
            body={<code className="font-mono">rb node create --enables {current.ref}</code>}
            tabbable={false}
            triggerClassName="flex shrink-0"
          >
            <Button variant="ghost" size="sm" onClick={() => ask(nodeCreate(plan, current, created))}>
              <Plus />
              Before {current.ref}
            </Button>
          </Tip>
        )}
        <Button variant="ghost" size="sm" onClick={() => ask(nodeCreate(plan, null, created))}>
          <Plus />
          Node
        </Button>
      </PanelHeader>
      <div
        ref={scroller}
        data-graph
        onWheel={onWheel}
        // Scrolls as before, without showing the scrollbars.
        className="mx-2 mt-1 mb-2 max-h-[50vh] overflow-auto rounded-xl bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg
            aria-hidden
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute top-0 left-0 fill-none"
          >
            {edges.map((edge) => {
              const active = touches(edge)
              return (
                <g
                  key={edge.id}
                  strokeWidth={active ? 2 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={active ? "stroke-interactive" : "stroke-muted-foreground/40"}
                >
                  <path data-edge={edge.id} d={edge.d} strokeDasharray={edge.dashed ? "4 4" : undefined} />
                  <path d={edge.arrow} />
                </g>
              )
            })}
          </svg>
          {layout.items.map((item) =>
            item.node ? (
              <Card
                key={item.id}
                item={item}
                node={item.node}
                selected={item.id === selected}
                mark={markOf(item.id)}
                onSelect={onSelect}
              />
            ) : (
              <End key={item.id} item={item} plan={plan} />
            ),
          )}
        </div>
      </div>
    </section>
  )
}
