import { useRef, type ReactNode } from "react"
import { Flag, MapPin, Plus, type LucideIcon } from "lucide-react"
import type { NodeView, PlanView } from "@engine/types.ts"
import { PanelHeader } from "@/components/plan/PanelHeader"
import { StatusBadge } from "@/components/plan/StatusBadge"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { IconAction } from "@/components/ui/IconAction"
import { SelectionGlide } from "@/components/ui/selectionGlide"
import { toCommand } from "@/lib/api"
import { gapText, levelText, num } from "@/lib/format"
import { nodeCreate, type Ask } from "@/lib/requests"
import { cn } from "@/lib/utils"

/** One end of the chain: the target above the nodes, the present below them. */
function End({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-1 pr-12 pl-3 text-subhead text-muted-foreground">
      <span className="flex w-9 shrink-0">
        <Icon className="size-4" />
      </span>
      <span className="flex-1">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  )
}

/** The nodes of a plan, from the target back to the present (`rb node list`). */
export function NodeChain({
  plan,
  selected,
  onSelect,
  ask,
  tools,
}: {
  plan: PlanView
  selected: string | null
  onSelect: (ref: string) => void
  ask: Ask
  tools?: ReactNode | undefined
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const created = (result: unknown) => onSelect((result as NodeView).ref)

  return (
    <section className="card-shadow flex flex-col rounded-2xl bg-surface-2">
      <PanelHeader
        title="Nodes"
        note="from the target back to the present"
        command={toCommand("node.list", { plan: plan.slug })}
      >
        {tools}
        {plan.nodes.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => ask(nodeCreate(plan, null, created))}>
            <Plus />
            Node
          </Button>
        )}
      </PanelHeader>
      {plan.nodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="max-w-pop-lg text-body text-muted-foreground">
            No node yet. Create the target first, then go backward: each new node is what the one after it requires.
          </p>
          <button
            type="button"
            className={buttonVariants({ variant: "signal" })}
            onClick={() => ask(nodeCreate(plan, null, created))}
          >
            Create the target
          </button>
        </div>
      ) : (
        <div ref={listRef} className="relative p-2">
          <SelectionGlide containerRef={listRef} selectedId={selected ?? ""} layoutKey={plan.slug} />
          <End icon={Flag} label="Target" value={`${num(plan.targetValue)} ${plan.unit}`} />
          {plan.nodes.map((node) => (
            <div key={node.ref} data-row-id={node.ref} className="relative flex items-center gap-1 rounded-lg pr-1">
              <button
                type="button"
                aria-current={node.ref === selected ? "true" : undefined}
                onClick={() => onSelect(node.ref)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left"
              >
                <code className="w-9 shrink-0 font-mono text-subhead text-muted-foreground">{node.ref}</code>
                <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground/90">{node.title}</span>
                {node.ready && (
                  <span data-ready className="shrink-0 rounded-sm bg-ok/15 px-1.5 text-caption font-medium text-ok">
                    ready
                  </span>
                )}
                <StatusBadge status={node.status} />
                <span
                  className={cn(
                    "w-20 shrink-0 text-right font-mono text-subhead tabular-nums",
                    node.gap === null ? "text-muted-foreground" : node.gap.ok ? "text-ok" : "text-danger",
                  )}
                >
                  {node.gap === null ? "-" : gapText(node.gap)}
                </span>
                <span
                  className={cn(
                    "w-20 shrink-0 text-right font-mono text-subhead tabular-nums",
                    node.level === null ? "text-muted-foreground italic" : "text-foreground",
                  )}
                >
                  {levelText(node.level)}
                </span>
              </button>
              <IconAction
                label={`Add the node before ${node.ref}`}
                command={`rb node create --enables ${node.ref}`}
                icon={Plus}
                side="left"
                onClick={() => ask(nodeCreate(plan, node, created))}
              />
            </div>
          ))}
          <End icon={MapPin} label="Present" value={`${num(plan.presentValue)} ${plan.unit}`} />
        </div>
      )}
    </section>
  )
}
