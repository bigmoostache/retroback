import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

/** A centred glyph over a short text, for a view with nothing to show yet. */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60">
        <Icon className="size-5" />
      </div>
      {children}
    </div>
  )
}
