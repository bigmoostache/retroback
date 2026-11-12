import { useState } from "react"
import type { OpInfo } from "@engine/types.ts"
import { OpForm } from "@/components/ops/OpForm"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { OpRequest } from "@/lib/requests"
import type { Engine } from "@/lib/useEngine"

/** Runs one action of the plan screen: the form of its operation, in a dialog. */
export function OpDialog({
  request,
  ops,
  run,
  onClose,
}: {
  request: OpRequest | null
  ops: OpInfo[]
  run: Engine["run"]
  onClose: () => void
}) {
  // Keep the last request on screen while the dialog plays its closing animation.
  const [shown, setShown] = useState(request)
  if (request && request !== shown) setShown(request)
  const info = shown ? ops.find((op) => op.name === shown.op) : undefined

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-dialog-md flex-col gap-4 overflow-y-auto p-5">
        {shown && (
          <>
            <div className="flex flex-col gap-1">
              <DialogTitle>{shown.title}</DialogTitle>
              {shown.description && <DialogDescription>{shown.description}</DialogDescription>}
            </div>
            {info ? (
              <OpForm
                info={info}
                fixed={shown.fixed}
                initial={shown.initial}
                changesOnly={shown.changesOnly}
                submitLabel={shown.submitLabel}
                destructive={shown.destructive}
                onRun={(input) => run(shown.op, input)}
                onDone={(result) => {
                  onClose()
                  shown.onDone?.(result)
                }}
                onCancel={onClose}
              />
            ) : (
              <p className="text-body text-muted-foreground">The engine does not list the operation {shown.op}.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
