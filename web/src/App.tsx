import { useState } from "react"
import { Target, Terminal } from "lucide-react"
import { OpDialog } from "@/components/ops/OpDialog"
import { OpsScreen } from "@/components/ops/OpsScreen"
import { PlanScreen } from "@/components/plan/PlanScreen"
import { SelectionPill } from "@/components/shell/chrome/SelectionPill"
import { StatusBar } from "@/components/shell/StatusBar"
import { ThemeToggle } from "@/components/shell/widgets/ThemeToggle"
import { Tip } from "@/components/ui/tip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/lib/providers/ThemeProvider"
import type { OpRequest } from "@/lib/requests"
import { useEngine } from "@/lib/useEngine"
import { cn } from "@/lib/utils"
import "@/styles/app.css"

const VIEWS = [
  { id: "plan", label: "Plan", hint: "The nodes, from the target back to the present", icon: Target },
  { id: "ops", label: "Operations", hint: "Every operation of the engine, as in rb help", icon: Terminal },
] as const

type View = (typeof VIEWS)[number]["id"]

function Shell() {
  const engine = useEngine()
  const [view, setView] = useState<View>("plan")
  const [request, setRequest] = useState<OpRequest | null>(null)

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        <header className="flex w-14 shrink-0 flex-col items-center gap-3 p-2">
          <nav
            aria-label="Views"
            className="relative flex w-full flex-col items-center gap-1 rounded-lg border border-(--border-strong) bg-muted/60 p-1"
          >
            <SelectionPill selectedKey={view} className="rounded-md" />
            {VIEWS.map(({ id, label, hint, icon: Icon }) => (
              <Tip key={id} title={label} body={hint} side="right" tabbable={false} triggerClassName="flex">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={view === id ? "page" : undefined}
                  data-selected={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    "relative flex size-8 items-center justify-center rounded-md transition-colors duration-base",
                    view === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              </Tip>
            ))}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-3">
            <ThemeToggle vertical />
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {view === "plan" ? <PlanScreen engine={engine} ask={setRequest} /> : <OpsScreen engine={engine} />}
        </div>
      </div>
      <StatusBar engine={engine} />
      <OpDialog request={request} ops={engine.ops} run={engine.run} onClose={() => setRequest(null)} />
    </div>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delay={350} closeDelay={80}>
        <Shell />
      </TooltipProvider>
    </ThemeProvider>
  )
}
