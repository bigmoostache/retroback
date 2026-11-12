import { plural } from "@/lib/format"
import type { Engine } from "@/lib/useEngine"
import { cn } from "@/lib/utils"

/** Footer: state of the engine API, and the last action as its `rb` command. */
export function StatusBar({ engine }: { engine: Engine }) {
  const { online, ops, last } = engine
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 px-2 text-callout">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          online === null ? "bg-muted-foreground/40" : online ? "bg-ok" : "bg-danger",
        )}
      />
      <span className="shrink-0 text-muted-foreground">
        {online === false ? "Engine API unreachable" : `Engine API, ${plural(ops.length, "operation")}`}
      </span>
      {last && (
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className={cn("shrink-0", last.ok ? "text-ok" : "text-danger")}>{last.ok ? "ok" : "error"}</span>
          <code className="truncate font-mono text-subhead text-foreground/80">{last.command}</code>
          {last.message && <span className="truncate text-danger">{last.message}</span>}
        </div>
      )}
    </footer>
  )
}
