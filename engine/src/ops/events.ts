/**
 * The event log: every operation that changed data, or tried to, in order.
 * Append only (the database refuses updates and deletes), so it tells exactly
 * who did what and when, and replaying it rebuilds a plan at any point.
 */
import { z } from "zod"
import { db } from "../db.ts"
import { slugify } from "../slug.ts"
import type { EventView, OpResponse, PlanView, ReplayView } from "../types.ts"
import { loadPlan } from "../views.ts"
import { defineOp, OpError, type Ctx, type Input } from "./define.ts"

type Run = (name: string, input: Input, ctx: Ctx) => Promise<OpResponse<unknown>>

const view = (e: {
  seq: number
  at: Date
  actor: string
  via: string
  op: string
  plan: string | null
  input: unknown
  ok: boolean
  error: string | null
}): EventView => ({
  seq: e.seq,
  at: e.at.toISOString(),
  actor: e.actor,
  via: e.via,
  op: e.op,
  plan: e.plan,
  input: e.input as Input,
  ok: e.ok,
  error: e.error,
})

/** The input of an event, moved to another plan. */
function moved(event: EventView, to: string): Input {
  if (event.op === "plan.create") return { ...event.input, slug: to }
  return { ...event.input, plan: to }
}

/** `run` is the registry's runOp, passed in so this file does not import the registry. */
export const eventOps = (run: Run) => [
  defineOp({
    name: "event.list",
    summary: "List the event log, oldest first: every operation that changed data or tried to, who asked, when, through what, and how it ended.",
    mutates: false,
    input: z.strictObject({
      plan: z.string().optional().describe("Only the events of this plan slug."),
      actor: z.string().optional().describe("Only the events of this actor."),
      since: z.number().int().optional().describe("Only the events after this sequence number."),
      last: z.number().int().min(1).max(1000).default(50).describe("How many events at most: the latest ones."),
    }),
    run: async ({ plan, actor, since, last }) => {
      const rows = await db.event.findMany({
        where: {
          ...(plan === undefined ? {} : { plan }),
          ...(actor === undefined ? {} : { actor }),
          ...(since === undefined ? {} : { seq: { gt: since } }),
        },
        orderBy: { seq: "desc" },
        take: last,
      })
      return rows.reverse().map(view)
    },
  }),

  defineOp({
    name: "event.replay",
    summary:
      "Replay the history of a plan into a new plan: its successful events, from its creation up to a sequence number (default: the end). Shows the plan exactly as it was then.",
    mutates: true,
    input: z.strictObject({
      plan: z.string().describe("Slug of the plan whose history is replayed. It may have been deleted since."),
      as: z.string().min(1).describe("Slug of the new plan to build. It must not exist."),
      upTo: z.number().int().optional().describe("Last sequence number replayed. Default: the end of the log."),
    }),
    run: async ({ plan, as, upTo }, ctx) => {
      const target = slugify(as)
      if (!target) throw new OpError("--as gives an empty slug.")
      if (target === plan) throw new OpError("--as must name a new plan, not the one replayed.")
      if (await db.plan.findUnique({ where: { slug: target } })) {
        throw new OpError(`A plan "${target}" already exists: --as must name a new plan.`, "conflict")
      }
      const until = upTo === undefined ? {} : { seq: { lte: upTo } }
      const created = await db.event.findFirst({
        where: { plan, op: "plan.create", ok: true, ...until },
        orderBy: { seq: "desc" },
      })
      if (!created) throw new OpError(`The log has no creation of plan "${plan}"${upTo === undefined ? "" : ` up to event ${upTo}`}.`, "not_found")
      const events = (
        await db.event.findMany({
          // A replay of this plan into another one is not part of its own history.
          where: { plan, ok: true, op: { not: "event.replay" }, seq: { gte: created.seq, ...(upTo === undefined ? {} : { lte: upTo }) } },
          orderBy: { seq: "asc" },
        })
      ).map(view)

      const replay: Ctx = { actor: ctx.actor, via: "replay" }
      let last = created.seq
      for (const event of events) {
        const response = await run(event.op, moved(event, target), replay)
        if (!response.ok) {
          throw new OpError(`Event ${event.seq} (${event.op}) does not replay: ${response.error.message}`, "conflict")
        }
        last = event.seq
      }
      const exists = await db.plan.findUnique({ where: { slug: target } })
      const result: ReplayView = {
        from: plan,
        as: target,
        replayed: events.length,
        upTo: last,
        plan: exists ? ((await loadPlan(target)) satisfies PlanView) : null,
      }
      return result
    },
  }),
]
