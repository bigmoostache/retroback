import { useRef } from "react"
import { Plus } from "lucide-react"
import type { PlanSummary } from "@engine/types.ts"
import { IconAction } from "@/components/ui/IconAction"
import { SelectionGlide } from "@/components/ui/selectionGlide"
import { plural } from "@/lib/format"
import { planCreate, type Ask } from "@/lib/requests"

/** The list of plans (`rb plan list`). */
export function PlanRail({
  plans,
  slug,
  onSelect,
  ask,
}: {
  plans: PlanSummary[]
  slug: string | null
  onSelect: (slug: string) => void
  ask: Ask
}) {
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <aside className="card-shadow my-2 flex w-(--sidebar-w) shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-2">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <h2 className="text-callout font-semibold text-foreground">Plans</h2>
        <span className="text-subhead text-muted-foreground/50 tabular-nums">{plans.length}</span>
        <span className="ml-auto flex">
          <IconAction label="New plan" command="rb plan create" icon={Plus} onClick={() => ask(planCreate())} />
        </span>
      </div>
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto p-2">
        <SelectionGlide containerRef={listRef} selectedId={slug ?? ""} layoutKey="plans" />
        {plans.map((plan) => (
          <button
            key={plan.slug}
            type="button"
            data-row-id={plan.slug}
            aria-current={plan.slug === slug ? "true" : undefined}
            onClick={() => onSelect(plan.slug)}
            className="relative flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left"
          >
            <span className="truncate text-body font-medium text-foreground/90">{plan.title}</span>
            <span className="flex items-center gap-2 text-subhead text-muted-foreground">
              <code className="truncate font-mono">{plan.slug}</code>
              <span className="ml-auto shrink-0 text-muted-foreground/50 tabular-nums">
                {plural(plan.nodeCount, "node")}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
