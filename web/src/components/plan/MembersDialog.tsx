import { useCallback, useEffect, useState, type FormEvent } from "react"
import { X } from "lucide-react"
import type { MemberView, PlanSummary } from "@engine/types.ts"
import { CommandHint } from "@/components/ops/CommandLine"
import { buttonVariants } from "@/components/ui/button-variants"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { IconAction } from "@/components/ui/IconAction"
import { Input } from "@/components/ui/input"
import { call } from "@/lib/api"
import type { Engine } from "@/lib/useEngine"
import { cn } from "@/lib/utils"

/** Who can see and change a plan (`rb plan members`): the owner shares and unshares, a contributor can leave. */
export function MembersDialog({
  plan,
  engine,
  open,
  onClose,
}: {
  plan: PlanSummary
  engine: Engine
  open: boolean
  onClose: () => void
}) {
  const me = engine.auth?.user?.email ?? ""
  const [members, setMembers] = useState<MemberView[]>([])
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const listed = await call<MemberView[]>("plan.members", { plan: plan.slug })
    if (listed.ok) setMembers(listed.result)
  }, [plan.slug])
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const owner = members.some((m) => m.role === "owner" && m.email === me)

  const share = async (event: FormEvent) => {
    event.preventDefault()
    const response = await engine.run("plan.share", { plan: plan.slug, email: email.trim() })
    if (!response.ok) return setError(response.error.message)
    setError(null)
    setEmail("")
    setMembers(response.result as MemberView[])
  }

  const unshare = async (member: MemberView) => {
    const response = await engine.run("plan.unshare", { plan: plan.slug, email: member.email })
    if (!response.ok) return setError(response.error.message)
    setError(null)
    // Leaving a plan takes it out of the list: nothing more to show here.
    if (member.email === me) onClose()
    else setMembers(response.result as MemberView[])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-dialog-md flex-col gap-4 overflow-y-auto p-5">
        <div className="flex flex-col gap-1">
          <DialogTitle>Members of "{plan.title}"</DialogTitle>
          <DialogDescription>
            Its owner, who created it, and the contributors it is shared with. Nobody else sees it.
          </DialogDescription>
        </div>
        <ul className="-mx-2 flex flex-col">
          {members.map((member) => (
            <li key={member.email} data-member={member.email} className="flex items-center gap-3 px-2 py-1">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium text-foreground/90">
                  {member.email}
                  {member.email === me && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                {member.name && <span className="truncate text-subhead text-muted-foreground">{member.name}</span>}
              </span>
              <span className="shrink-0 text-subhead text-muted-foreground">{member.role}</span>
              {member.role === "contributor" && (owner || member.email === me) ? (
                <IconAction
                  label={member.email === me ? "Leave the plan" : "Remove"}
                  command={`rb plan unshare --plan ${plan.slug} --email ${member.email}`}
                  icon={X}
                  side="left"
                  onClick={() => void unshare(member)}
                />
              ) : (
                <span className="size-6 shrink-0" />
              )}
            </li>
          ))}
        </ul>
        {owner && (
          <form onSubmit={(event) => void share(event)} className="flex items-center gap-2">
            <Input value={email} placeholder="Email, e.g. ana@corp.com" onChange={(e) => setEmail(e.target.value)} />
            <button
              type="submit"
              disabled={email.trim() === ""}
              className={cn(buttonVariants({ variant: "signal", size: "sm" }), "shrink-0")}
            >
              Share
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-callout break-words text-danger">
            {error}
          </p>
        )}
        <CommandHint command={`rb plan members --plan ${plan.slug}`} />
      </DialogContent>
    </Dialog>
  )
}
