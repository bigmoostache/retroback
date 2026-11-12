import { useState } from "react"
import { Pencil, Target, Trash2, Unplug, Users } from "lucide-react"
import { CommandHint } from "@/components/ops/CommandLine"
import { LayoutSwitch, type PlanLayout } from "@/components/plan/LayoutSwitch"
import { MembersDialog } from "@/components/plan/MembersDialog"
import { NodeChain } from "@/components/plan/NodeChain"
import { NodeDetail } from "@/components/plan/NodeDetail"
import { NodeGraph } from "@/components/plan/NodeGraph"
import { PlanRail } from "@/components/plan/PlanRail"
import { buttonVariants } from "@/components/ui/button-variants"
import { EmptyState } from "@/components/ui/EmptyState"
import { IconAction } from "@/components/ui/IconAction"
import { toCommand } from "@/lib/api"
import { num } from "@/lib/format"
import { planCreate, planDelete, planUpdate, type Ask } from "@/lib/requests"
import type { Engine } from "@/lib/useEngine"
import { useNode } from "@/lib/useEngine"

/** Where the choice between the graph and the list is kept. */
const LAYOUT_KEY = "rb-layout"

/** A plan: its nodes as a graph or as a list, and the node selected. */
export function PlanScreen({ engine, ask }: { engine: Engine; ask: Ask }) {
  const { plan, plans, slug, online, run } = engine
  const [selected, setSelected] = useState<string | null>(null)
  const [unlockOf, setUnlockOf] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  // The unlock view belongs to one plan.
  const [unlockPlan, setUnlockPlan] = useState(slug)
  if (unlockPlan !== slug) {
    setUnlockPlan(slug)
    setUnlockOf(null)
  }
  const showUnlock = (ref: string | null) => {
    if (ref) {
      setSelected(ref)
      setLayout("graph")
      localStorage.setItem(LAYOUT_KEY, "graph")
    }
    setUnlockOf(ref)
  }
  const [layout, setLayout] = useState<PlanLayout>(() =>
    localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "graph",
  )
  const selectedRef = (selected && plan?.nodes.some((n) => n.ref === selected) ? selected : plan?.nodes[0]?.ref) ?? null
  const node = useNode(plan?.slug ?? null, selectedRef, engine.version)
  // With no node yet there is nothing to draw: the list shows how to create the target.
  const hasNodes = (plan?.nodes.length ?? 0) > 0
  const tools = hasNodes ? (
    <LayoutSwitch
      layout={layout}
      onChange={(next) => {
        localStorage.setItem(LAYOUT_KEY, next)
        setLayout(next)
      }}
    />
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
      <PlanRail plans={plans} slug={slug} onSelect={engine.selectPlan} ask={ask} />
      {online === false && !plan ? (
        <EmptyState icon={Unplug}>
          <p className="max-w-pop-lg text-body text-muted-foreground">The engine API does not answer.</p>
          <CommandHint command="pnpm api" />
        </EmptyState>
      ) : online && plans.length === 0 ? (
        <EmptyState icon={Target}>
          <p className="max-w-pop-lg text-body text-muted-foreground">
            No plan yet. A plan fixes one metric, its value today and the value aimed at. Its nodes are then created
            from the target backward.
          </p>
          <button type="button" className={buttonVariants({ variant: "signal" })} onClick={() => ask(planCreate())}>
            New plan
          </button>
          <CommandHint command="rb plan create" />
        </EmptyState>
      ) : plan ? (
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <MembersDialog plan={plan} engine={engine} open={membersOpen} onClose={() => setMembersOpen(false)} />
          <header className="flex items-start gap-2 px-6 pt-5 pb-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline gap-3">
                <h1 className="truncate text-title2 font-semibold tracking-tight text-foreground">{plan.title}</h1>
                <code className="shrink-0 font-mono text-subhead text-muted-foreground">{plan.slug}</code>
              </div>
              <p className="text-body text-muted-foreground">{plan.target}</p>
              <p className="font-mono text-subhead text-foreground/80 tabular-nums">
                {plan.metric}: {num(plan.presentValue)} -&gt; {num(plan.targetValue)} {plan.unit}, steps of{" "}
                {num(plan.gapPercent)}% at most
              </p>
            </div>
            <span className="flex h-6 items-center">
              <CommandHint command={toCommand("plan.show", { plan: plan.slug })} />
            </span>
            <IconAction
              label="Members: share the plan"
              command="rb plan members"
              icon={Users}
              onClick={() => setMembersOpen(true)}
            />
            <IconAction label="Edit the plan" command="rb plan update" icon={Pencil} onClick={() => ask(planUpdate(plan))} />
            <IconAction
              label="Delete the plan"
              command="rb plan delete"
              icon={Trash2}
              onClick={() => ask(planDelete(plan))}
            />
          </header>
          {layout === "graph" && hasNodes ? (
            // The graph runs across the whole width; the rest sits under it.
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-4">
              <NodeGraph
                key={plan.slug}
                plan={plan}
                selected={selectedRef}
                onSelect={setSelected}
                ask={ask}
                tools={tools}
                unlockOf={unlockOf}
                onUnlock={showUnlock}
              />
              <div className="-m-1 flex min-h-0 flex-1 flex-row gap-4 overflow-hidden p-1">
                {node && (
                  <NodeDetail
                    node={node}
                    plan={plan}
                    run={run}
                    ask={ask}
                    onSelect={setSelected}
                    unlockOf={unlockOf}
                    onUnlock={showUnlock}
                    wide
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-row gap-4 overflow-hidden px-6 pb-4">
              <div className="-m-1 flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
                <NodeChain plan={plan} selected={selectedRef} onSelect={setSelected} ask={ask} tools={tools} />
              </div>
              {node && (
                <NodeDetail
                  node={node}
                  plan={plan}
                  run={run}
                  ask={ask}
                  onSelect={setSelected}
                  unlockOf={unlockOf}
                  onUnlock={showUnlock}
                />
              )}
            </div>
          )}
        </section>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  )
}
