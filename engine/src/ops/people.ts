/** Users, who can access each plan, and the named API keys `rb` signs in with. */
import { z } from "zod"
import { assertOwner, hashSecret, newSecret, roleIn, signedIn, userByEmail } from "../access.ts"
import { db } from "../db.ts"
import type { ApiKeyView, MemberView, UserView } from "../types.ts"
import { planOf } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const emailFlag = z.string().min(3).describe("Email of the person, as Google knows it.")
const keyNameFlag = z.string().trim().min(1).max(60).describe("Name of the key, unique for you, e.g. laptop or ci.")

async function membersOf(planId: string): Promise<MemberView[]> {
  const rows = await db.planMember.findMany({
    where: { planId },
    include: { user: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  })
  return rows.map((m) => ({ email: m.user.email, name: m.user.name, role: m.role }))
}

const keyView = (k: { name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }): ApiKeyView => ({
  name: k.name,
  prefix: k.prefix,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revoked: k.revokedAt !== null,
})

export const peopleOps = [
  defineOp({
    name: "user.me",
    summary: "Who you are signed in as, and the plans you own or contribute to.",
    mutates: false,
    input: z.strictObject({}),
    run: async () => {
      const me = signedIn()
      const user = await db.user.findUniqueOrThrow({
        where: { id: me.id },
        include: { plans: { include: { plan: { select: { slug: true } } }, orderBy: { createdAt: "asc" } } },
      })
      const result: UserView = {
        email: user.email,
        name: user.name,
        plans: user.plans.map((m) => ({ plan: m.plan.slug, role: m.role })),
      }
      return result
    },
  }),

  defineOp({
    name: "plan.members",
    summary: "List who can see and change a plan: its owner and its contributors.",
    mutates: false,
    input: z.strictObject({ plan: planFlag }),
    run: async ({ plan }) => membersOf((await planOf(plan)).id),
  }),

  defineOp({
    name: "plan.share",
    summary: "Give a person access to a plan as a contributor. Only the owner can. They see it at their next login.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, email: emailFlag }),
    run: async ({ plan, email }) => {
      const current = await planOf(plan)
      await assertOwner(current)
      const user = await userByEmail(email)
      if (await roleIn(current.id, user)) throw new OpError(`${user.email} already has access to "${current.slug}".`, "conflict")
      await db.planMember.create({ data: { planId: current.id, userId: user.id, role: "contributor" } })
      return membersOf(current.id)
    },
  }),

  defineOp({
    name: "plan.unshare",
    summary: "Remove a contributor from a plan. The owner can remove anyone but themselves; a contributor can leave.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, email: emailFlag }),
    run: async ({ plan, email }) => {
      const current = await planOf(plan)
      const me = signedIn()
      const clean = email.trim().toLowerCase()
      if (clean !== me.email) await assertOwner(current)
      const user = await db.user.findUnique({ where: { email: clean } })
      const role = user ? await roleIn(current.id, user) : null
      if (!user || !role) throw new OpError(`${clean} has no access to "${current.slug}".`, "not_found")
      if (role === "owner") throw new OpError(`${clean} owns "${current.slug}": the owner cannot be removed.`, "conflict")
      await db.planMember.delete({ where: { planId_userId: { planId: current.id, userId: user.id } } })
      return membersOf(current.id)
    },
  }),

  defineOp({
    name: "key.list",
    summary: "List your API keys: name, first characters, when last used. Secrets are never shown again.",
    mutates: false,
    input: z.strictObject({}),
    run: async () => {
      const rows = await db.apiKey.findMany({ where: { userId: signedIn().id }, orderBy: { createdAt: "asc" } })
      return rows.map(keyView)
    },
  }),

  defineOp({
    name: "key.create",
    summary: "Create a named API key for rb, acting as you. The secret is shown once: pass it with --key or RB_KEY.",
    mutates: true,
    input: z.strictObject({ name: keyNameFlag }),
    run: async ({ name }) => {
      const me = signedIn()
      if (await db.apiKey.findUnique({ where: { userId_name: { userId: me.id, name } } })) {
        throw new OpError(`You already have a key "${name}". Revoke it or pick another name.`, "conflict")
      }
      const secret = newSecret("rb_")
      const row = await db.apiKey.create({
        data: { userId: me.id, name, prefix: secret.slice(0, 7), hash: hashSecret(secret) },
      })
      return { ...keyView(row), secret }
    },
  }),

  defineOp({
    name: "key.revoke",
    summary: "Revoke one of your API keys: rb stops working with it at once. Its name is freed.",
    mutates: true,
    input: z.strictObject({ name: keyNameFlag }),
    run: async ({ name }) => {
      const me = signedIn()
      const row = await db.apiKey.findUnique({ where: { userId_name: { userId: me.id, name } } })
      if (!row) throw new OpError(`You have no key "${name}". List them with: rb key list`, "not_found")
      // Renamed so the name can be used again; the row stays, revoked.
      const done = await db.apiKey.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), name: `${name}~revoked-${row.id}` },
      })
      return { ...keyView(done), name }
    },
  }),
]
