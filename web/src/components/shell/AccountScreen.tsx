import { useCallback, useEffect, useState, type FormEvent } from "react"
import { KeyRound, LogOut, X } from "lucide-react"
import type { ApiKeyView } from "@engine/types.ts"
import { CommandHint, CommandLine } from "@/components/ops/CommandLine"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { IconAction } from "@/components/ui/IconAction"
import { Input } from "@/components/ui/input"
import { call } from "@/lib/api"
import type { Engine } from "@/lib/useEngine"
import { cn } from "@/lib/utils"

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
const day = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "never")

/** Who is signed in, and the API keys `rb` signs in with (`rb key list`). */
export function AccountScreen({ engine }: { engine: Engine }) {
  const { auth, run, signOut } = engine
  const [keys, setKeys] = useState<ApiKeyView[]>([])
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null)

  const load = useCallback(async () => {
    const listed = await call<ApiKeyView[]>("key.list")
    if (listed.ok) setKeys(listed.result)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const response = await run("key.create", { name: name.trim() })
    if (!response.ok) {
      setError(response.error.message)
      return
    }
    const key = response.result as ApiKeyView
    setError(null)
    setName("")
    setSecret({ name: key.name, secret: key.secret ?? "" })
    await load()
  }

  const revoke = async (key: ApiKeyView) => {
    const response = await run("key.revoke", { name: key.name })
    setError(response.ok ? null : response.error.message)
    if (secret?.name === key.name) setSecret(null)
    await load()
  }

  const active = keys.filter((k) => !k.revoked)
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-title2 font-semibold tracking-tight text-foreground">Account</h1>
          <p className="text-body text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{auth?.user?.email}</span>
            {auth?.dev && " (DEV=true, no Google)"}
          </p>
          <CommandHint command="rb user me" />
        </div>
        {!auth?.dev && (
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        )}
      </header>

      <div className="card-shadow flex w-full max-w-dialog-md flex-col gap-3 rounded-2xl bg-surface-2 p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-callout font-semibold text-foreground">API keys</h2>
          <span className="text-subhead text-muted-foreground/50 tabular-nums">{active.length}</span>
          <span className="ml-auto">
            <CommandHint command="rb key list" />
          </span>
        </div>
        <p className="text-body text-muted-foreground">
          A key lets <code className="font-mono">rb</code> act as you. Pass it with{" "}
          <code className="font-mono">--key</code> or <code className="font-mono">RB_KEY</code>.
        </p>
        {active.length === 0 ? (
          <p className="text-body text-muted-foreground/70">No key yet.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {active.map((key) => (
              <li key={key.name} data-key={key.name} className="flex items-center gap-3 px-2 py-1">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground/90">{key.name}</span>
                <code className="shrink-0 font-mono text-subhead text-muted-foreground">{key.prefix}…</code>
                <span className="w-40 shrink-0 text-right text-subhead text-muted-foreground tabular-nums">
                  used {day(key.lastUsedAt)}
                </span>
                <IconAction
                  label="Revoke"
                  command={`rb key revoke --name ${key.name}`}
                  icon={X}
                  side="left"
                  onClick={() => void revoke(key)}
                />
              </li>
            ))}
          </ul>
        )}
        {secret && (
          <div className="flex flex-col gap-1">
            <p className="text-callout text-foreground">
              Key "{secret.name}" created. Copy its secret now: it is not shown again.
            </p>
            <CommandLine command={`export RB_KEY=${secret.secret}`} />
          </div>
        )}
        <form onSubmit={(event) => void create(event)} className="flex items-center gap-2">
          <Input value={name} placeholder="Name, e.g. laptop" onChange={(e) => setName(e.target.value)} />
          <button
            type="submit"
            disabled={name.trim() === ""}
            className={cn(buttonVariants({ variant: "signal", size: "sm" }), "shrink-0")}
          >
            Create a key
          </button>
        </form>
        {error && (
          <p role="alert" className="text-callout break-words text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
