import type { ReactNode } from "react"
import { CommandHint } from "@/components/ops/CommandLine"

/** Title row of a panel, with the `rb` command that prints the same thing. */
export function PanelHeader({
  title,
  note,
  command,
  children,
}: {
  title: string
  note?: ReactNode | undefined
  command?: string | undefined
  children?: ReactNode | undefined
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-1">
      <h2 className="shrink-0 text-callout font-semibold text-foreground">{title}</h2>
      {note && <span className="shrink-0 text-subhead text-muted-foreground">{note}</span>}
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {command && <CommandHint command={command} />}
        {children}
      </div>
    </div>
  )
}
