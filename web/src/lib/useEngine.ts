import { useCallback, useEffect, useRef, useState } from "react"
import type { OpInfo, OpResponse, PlanSummary, PlanView } from "@engine/types.ts"
import { call, toCommand, type Input } from "@/lib/api"

const SLUG_KEY = "rb-plan"
/** The CLI can change the data while the page is open: reread it this often. */
const POLL_MS = 4000

export interface LastRun {
  command: string
  ok: boolean
  message: string | null
}

export interface Engine {
  /** Null until the first answer. */
  online: boolean | null
  ops: OpInfo[]
  plans: PlanSummary[]
  /** Slug of the plan shown. */
  slug: string | null
  plan: PlanView | null
  selectPlan: (slug: string) => void
  /** Runs an operation, then rereads the data. */
  run: (op: string, input?: Input) => Promise<OpResponse<unknown>>
  /** The last operation run from the page, as its `rb` command. */
  last: LastRun | null
}

export function useEngine(): Engine {
  const [online, setOnline] = useState<boolean | null>(null)
  const [ops, setOps] = useState<OpInfo[]>([])
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [slug, setSlug] = useState<string | null>(() => localStorage.getItem(SLUG_KEY))
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [last, setLast] = useState<LastRun | null>(null)
  const wanted = useRef(slug)
  const seen = useRef("")
  const hasOps = useRef(false)

  const refresh = useCallback(async () => {
    const asked = wanted.current
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
    const shown = current ? await call<PlanView>("plan.show", { plan: current }) : null
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
        if (op === "plan.create") want((response.result as PlanView).slug)
        await refresh()
      }
      return response
    },
    [want, refresh],
  )

  return { online, ops, plans, slug, plan, selectPlan, run, last }
}
