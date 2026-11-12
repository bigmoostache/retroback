import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/ui/tip"

/** An icon-only action. Its tip names the action and the `rb` command behind it. */
export function IconAction({
  label,
  command,
  icon: Icon,
  onClick,
  side,
}: {
  label: string
  command?: string | undefined
  icon: LucideIcon
  onClick: () => void
  side?: "top" | "bottom" | "left" | "right" | undefined
}) {
  return (
    <Tip
      title={label}
      body={command ? <code className="font-mono">{command}</code> : undefined}
      side={side}
      tabbable={false}
      triggerClassName="flex shrink-0"
    >
      <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} className="text-muted-foreground">
        <Icon />
      </Button>
    </Tip>
  )
}
