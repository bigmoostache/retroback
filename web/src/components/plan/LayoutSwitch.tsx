import { SelectionPill } from "@/components/shell/chrome/SelectionPill"
import { cn } from "@/lib/utils"

/** How the nodes of a plan are shown. */
export type PlanLayout = "graph" | "list"

const LAYOUTS: { id: PlanLayout; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "list", label: "List" },
]

export function LayoutSwitch({ layout, onChange }: { layout: PlanLayout; onChange: (layout: PlanLayout) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      className="relative flex shrink-0 items-center gap-1 rounded-lg border border-(--border-strong) bg-muted/60 p-1"
    >
      <SelectionPill selectedKey={layout} className="rounded-md" />
      {LAYOUTS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={id === layout}
          data-selected={id === layout}
          onClick={() => {
            if (id !== layout) onChange(id)
          }}
          className={cn(
            "relative flex h-6 items-center rounded-md px-2 text-subhead font-medium transition-colors duration-base",
            id === layout ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
