import type { NodeStatus } from "@engine/types.ts"
import { Badge } from "@/components/ui/badge"

const TONE: Record<NodeStatus, string> = {
  todo: "bg-muted text-muted-foreground",
  doing: "bg-interactive/15 text-interactive",
  done: "bg-ok/15 text-ok",
}

export function StatusBadge({ status }: { status: NodeStatus }) {
  return (
    <Badge variant="secondary" className={TONE[status]}>
      {status}
    </Badge>
  )
}
