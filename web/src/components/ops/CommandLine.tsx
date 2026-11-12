import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Tip } from "@/components/ui/tip"
import { cn } from "@/lib/utils"

/** An `rb` command, ready to copy: what the CLI needs to do the same thing. */
export function CommandLine({ command, className }: { command: string; className?: string | undefined }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className={cn("flex items-start gap-2 rounded-lg bg-muted/60 py-2 pr-2 pl-3", className)}>
      <code className="min-w-0 flex-1 py-0.5 font-mono text-subhead break-words text-foreground/90">{command}</code>
      <Tip title={copied ? "Copied" : "Copy the command"} tabbable={false} triggerClassName="flex">
        <button
          type="button"
          onClick={copy}
          aria-label="Copy the command"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </Tip>
    </div>
  )
}

/** The command that prints what a section shows. */
export function CommandHint({ command }: { command: string }) {
  return <code className="truncate font-mono text-caption text-muted-foreground/60">{command}</code>
}
