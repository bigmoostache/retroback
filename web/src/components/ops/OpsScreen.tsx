import { useRef, useState } from "react"
import { Unplug } from "lucide-react"
import type { OpInfo, OpResponse } from "@engine/types.ts"
import { OpForm } from "@/components/ops/OpForm"
import { EmptyState } from "@/components/ui/EmptyState"
import { SelectionGlide } from "@/components/ui/selectionGlide"
import type { Engine } from "@/lib/useEngine"

/** Operations in the order of the registry, grouped by entity like `rb help`. */
function byEntity(ops: OpInfo[]) {
  const groups: [string, OpInfo[]][] = []
  for (const op of ops) {
    const entity = op.name.split(".")[0] ?? ""
    const last = groups.at(-1)
    if (last && last[0] === entity) last[1].push(op)
    else groups.push([entity, [op]])
  }
  return groups
}

/**
 * Every operation of the engine, each with the form of its inputs. The list is
 * the one `rb help` prints, so nothing the CLI does is missing here.
 */
export function OpsScreen({ engine }: { engine: Engine }) {
  const { ops, run } = engine
  const [name, setName] = useState("plan.list")
  const [answer, setAnswer] = useState<{ op: string; body: OpResponse<unknown> } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const info = ops.find((op) => op.name === name) ?? ops[0]

  if (!info) {
    return (
      <EmptyState icon={Unplug}>
        <p className="max-w-pop-lg text-body text-muted-foreground">
          {engine.online === false ? "The engine API does not answer." : "Loading the operations."}
        </p>
      </EmptyState>
    )
  }

  const op = info.name
  return (
    <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
      <aside className="card-shadow my-2 flex w-(--sidebar-w) shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <h2 className="text-callout font-semibold text-foreground">Operations</h2>
          <span className="text-subhead text-muted-foreground/50 tabular-nums">{ops.length}</span>
        </div>
        <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto p-2">
          <SelectionGlide containerRef={listRef} selectedId={op} layoutKey="ops" />
          {byEntity(ops).map(([entity, list]) => (
            <div key={entity} className="pb-2">
              <div className="px-3 pt-1 pb-1 text-subhead text-muted-foreground/60">{entity}</div>
              {list.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  data-row-id={item.name}
                  aria-current={item.name === op ? "true" : undefined}
                  onClick={() => setName(item.name)}
                  className="relative flex w-full items-center gap-2 rounded-lg px-3 py-1 text-left"
                >
                  <code className="font-mono text-subhead text-foreground/90">{item.name.replace(".", " ")}</code>
                  {item.mutates && <span className="ml-auto text-caption text-muted-foreground/50">writes</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        <header className="flex flex-col gap-1">
          <h1 className="font-mono text-title3 font-semibold text-foreground">rb {op.replace(".", " ")}</h1>
          <p className="text-body text-muted-foreground">{info.summary}</p>
          <code className="font-mono text-caption break-words text-muted-foreground/70">{info.cli}</code>
        </header>
        <div className="card-shadow w-full max-w-dialog-md rounded-2xl bg-surface-2 p-4">
          <OpForm
            key={op}
            info={info}
            onRun={async (input) => {
              const body = await run(op, input)
              setAnswer({ op, body })
              return body
            }}
          />
        </div>
        {answer?.op === op && (
          <div className="flex flex-col gap-1">
            <span className="text-subhead text-muted-foreground">Answer, as printed by the command with --json</span>
            <pre className="overflow-x-auto rounded-2xl bg-muted/60 p-4 font-mono text-subhead text-foreground/90">
              {JSON.stringify(answer.body, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  )
}
