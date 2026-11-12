import type { CheckView, PlanView } from "@engine/types.ts"
import { PanelHeader } from "@/components/plan/PanelHeader"
import { toCommand } from "@/lib/api"
import { num, plural } from "@/lib/format"
import { cn } from "@/lib/utils"

/** The issues of a plan (`rb plan check`). */
export function CheckPanel({ check, onSelect }: { check: CheckView; onSelect: (ref: string) => void }) {
  const errors = check.issues.filter((issue) => issue.severity === "error").length
  const warnings = check.issues.length - errors
  return (
    <section className="card-shadow flex flex-col rounded-2xl bg-surface-2 pb-2">
      <PanelHeader
        title="Check"
        note={
          <>
            <span className={check.ok ? "text-ok" : "text-danger"}>{check.ok ? "ok" : "failed"}</span>
            {`, ${plural(errors, "error")}, ${plural(warnings, "warning")}`}
          </>
        }
        command={toCommand("plan.check", { plan: check.plan })}
      />
      {check.issues.length === 0 ? (
        <p className="px-4 py-1 text-body text-muted-foreground">No issue.</p>
      ) : (
        <ul className="flex flex-col px-2">
          {check.issues.map((issue, i) => {
            const ref = issue.node
            return (
              <li key={i} className="flex items-start gap-3 px-2 py-1 text-body">
                <span
                  aria-label={issue.severity}
                  className={cn(
                    "mt-2 size-2 shrink-0 rounded-full",
                    issue.severity === "error" ? "bg-danger" : "bg-warn",
                  )}
                />
                {ref ? (
                  <button
                    type="button"
                    onClick={() => onSelect(ref)}
                    className="w-9 shrink-0 text-left font-mono text-subhead leading-6 text-interactive hover:underline"
                  >
                    {ref}
                  </button>
                ) : (
                  <span className="w-9 shrink-0" />
                )}
                <span className="min-w-0 flex-1 text-foreground/90">{issue.message}</span>
                <code className="shrink-0 font-mono text-caption leading-6 text-muted-foreground/60">{issue.code}</code>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** What the whole plan needs, summed over its nodes (part of `rb plan show`). */
export function ResourcePanel({ plan }: { plan: PlanView }) {
  return (
    <section className="card-shadow flex flex-col rounded-2xl bg-surface-2 pb-2">
      <PanelHeader title="Resources" note="summed over the nodes" command={toCommand("plan.show", { plan: plan.slug })} />
      {plan.resources.length === 0 ? (
        <p className="px-4 py-1 text-body text-muted-foreground">No resource yet.</p>
      ) : (
        <ul className="flex flex-col px-2">
          {plan.resources.map((resource) => (
            <li
              key={`${resource.kind}/${resource.name}/${resource.unit}`}
              className="flex items-baseline gap-3 px-2 py-1 text-body"
            >
              <span className="w-24 shrink-0 truncate text-muted-foreground">{resource.kind}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{resource.name}</span>
              <span className="shrink-0 font-mono text-subhead text-muted-foreground/60">
                {resource.nodes.join(" ")}
              </span>
              <span className="w-36 shrink-0 text-right font-mono text-subhead text-foreground tabular-nums">
                {num(resource.quantity)} {resource.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
