import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeView, OpInfo, OpResponse, PlanGraph, PlanSummary } from "@engine/types.ts"
import { call, toCommand, type Input } from "@/lib/api"

const SLUG_KEY = "rb-plan"
/** The CLI can change the data while the page is open: reread it this often. */
const POLL_MS = 4000

export interface LastRun {
  command: string
  ok: boolean
  message: string | null
}

export interface Auth {
  /** Null when nobody is signed in. */
  user: { email: string } | null
  /** DEV=true: signed in as local@dev, no Google. */
  dev: boolean
  /** Google sign-in is set up. */
  google: boolean
}

export interface Engine {
  /** Null until the first answer. */
  online: boolean | null
  /** Null until /auth/me answers. */
  auth: Auth | null
  signOut: () => Promise<void>
  ops: OpInfo[]
  plans: PlanSummary[]
  /** Slug of the plan shown. */
  slug: string | null
  /** The plan in compact form (`rb plan graph`); a node in full comes from useNode. */
  plan: PlanGraph | null
  /** Changes whenever the plan does. */
  version: number
  selectPlan: (slug: string) => void
  /** Runs an operation, then rereads the data. */
  run: (op: string, input?: Input) => Promise<OpResponse<unknown>>
  /** The last operation run from the page, as its `rb` command. */
  last: LastRun | null
}

export function useEngine(): Engine {
  const [online, setOnline] = useState<boolean | null>(null)
  const [auth, setAuth] = useState<Auth | null>(null)
  const [ops, setOps] = useState<OpInfo[]>([])
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [slug, setSlug] = useState<string | null>(() => localStorage.getItem(SLUG_KEY))
  const [plan, setPlan] = useState<PlanGraph | null>(null)
  /** Bumped whenever the plan changes: the selected node is fetched again. */
  const [version, setVersion] = useState(0)
  const [last, setLast] = useState<LastRun | null>(null)
  const wanted = useRef(slug)
  const seen = useRef("")
  const seenAuth = useRef("")
  const hasOps = useRef(false)

  const refresh = useCallback(async () => {
    const asked = wanted.current
    const me = await whoAmI()
    if (me) {
      const signature = JSON.stringify(me)
      if (signature !== seenAuth.current) {
        seenAuth.current = signature
        setAuth(me)
      }
    }
    if (me && !me.user) {
      setOnline(true)
      return
    }
    if (!hasOps.current) {
      const listed = await call<OpInfo[]>("op.list")
      if (listed.ok) {
        hasOps.current = true
        setOps(listed.result)
      }
    }
    const list = await call<PlanSummary[]>("plan.list")
    setOnline(list.ok)
    if (!list.ok) return
    const current = list.result.some((p) => p.slug === asked) ? asked : (list.result[0]?.slug ?? null)
    const shown = current ? await call<PlanGraph>("plan.graph", { plan: current }) : null
    // Another plan was selected meanwhile: a newer refresh is on its way.
    if (wanted.current !== asked) return
    const view = shown?.ok ? shown.result : null
    const signature = JSON.stringify([list.result, view])
    if (signature === seen.current) return
    seen.current = signature
    wanted.current = current
    setSlug(current)
    setPlans(list.result)
    setPlan(view)
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const want = useCallback((next: string) => {
    wanted.current = next
    localStorage.setItem(SLUG_KEY, next)
  }, [])

  const selectPlan = useCallback(
    (next: string) => {
      want(next)
      setSlug(next)
      void refresh()
    },
    [want, refresh],
  )

  const run = useCallback(
    async (op: string, input: Input = {}) => {
      const response = await call(op, input)
      setLast({
        command: toCommand(op, input),
        ok: response.ok,
        message: response.ok ? null : response.error.message,
      })
      if (response.ok) {
        if (op === "plan.create") want((response.result as PlanSummary).slug)
        await refresh()
      }
      return response
    },
    [want, refresh],
  )

  const signOut = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST" }).catch(() => undefined)
    seen.current = ""
    setPlans([])
    setPlan(null)
    await refresh()
  }, [refresh])

  return { online, auth, signOut, ops, plans, slug, plan, version, selectPlan, run, last }
}

/**
 * One node in full (`rb node show`), fetched when it is selected and again
 * whenever the plan changes. Null while loading or when it does not exist.
 */
export function useNode(slug: string | null, ref: string | null, version: number): NodeView | null {
  const [node, setNode] = useState<NodeView | null>(null)
  useEffect(() => {
    if (!slug || !ref) {
      setNode(null)
      return
    }
    let live = true
    void call<NodeView>("node.show", { plan: slug, ref }).then((r) => {
      if (live) setNode(r.ok ? r.result : null)
    })
    return () => {
      live = false
    }
  }, [slug, ref, version])
  // A node of another plan or another ref is never shown while the right one loads.
  return node && node.plan === slug && node.ref === ref ? node : null
}

/** Who the browser is signed in as. Null when the API does not answer. */
async function whoAmI(): Promise<Auth | null> {
  try {
    const res = await fetch("/auth/me")
    if (!res.ok) return null
    return (await res.json()) as Auth
  } catch {
    return null
  }
}
