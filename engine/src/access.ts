/**
 * Who may touch which plan. A plan is seen and changed by its members only:
 * its owner (the creator, exactly one) and its contributors. A plan the user
 * is not a member of answers not_found, so its existence does not leak.
 *
 * The context of the running operation is kept in an AsyncLocalStorage set by
 * runOp, so reading a plan checks access without passing the user everywhere.
 * A context without a user is the engine itself (maintenance): no check.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { createHash, randomBytes } from "node:crypto"
import { db } from "./db.ts"
import { OpError, type Ctx, type User } from "./ops/define.ts"

const current = new AsyncLocalStorage<Ctx>()

export const withCtx = <T>(ctx: Ctx, fn: () => Promise<T>) => current.run(ctx, fn)

/** The user the running operation acts as; null for the engine itself. */
export const currentUser = (): User | null => current.getStore()?.user ?? null

/** The signed-in user, or an error for an operation that needs one. */
export function signedIn(): User {
  const user = currentUser()
  if (!user) throw new OpError("This operation needs a signed-in user.", "forbidden")
  return user
}

/** Prisma filter: the plans the running user can see (all of them for the engine). */
export function visiblePlans() {
  const user = currentUser()
  return user ? { members: { some: { userId: user.id } } } : {}
}

export async function roleIn(planId: string, user: User) {
  const row = await db.planMember.findUnique({ where: { planId_userId: { planId, userId: user.id } } })
  return row?.role ?? null
}

/** Refuses unless the running user owns the plan. */
export async function assertOwner(plan: { id: string; slug: string }) {
  const user = currentUser()
  if (!user) return
  if ((await roleIn(plan.id, user)) !== "owner") {
    throw new OpError(`Only the owner of "${plan.slug}" can do this.`, "forbidden")
  }
}

/** The user with this email, created when it is new (a plan can be shared before its first login). */
export async function userByEmail(email: string, name = "") {
  const clean = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new OpError(`"${email}" is not an email.`)
  return db.user.upsert({ where: { email: clean }, update: name ? { name } : {}, create: { email: clean, name } })
}

// ------------------------------------------------------------- secrets

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex")

/** A new random secret with a readable prefix: rb_... for API keys, a bare token for sessions. */
export const newSecret = (prefix = "") => `${prefix}${randomBytes(24).toString("base64url")}`

/** The user behind an API key, or null when the key is unknown or revoked. */
export async function userOfKey(secret: string): Promise<User | null> {
  const key = await db.apiKey.findUnique({ where: { hash: hashSecret(secret) }, include: { user: true } })
  if (!key || key.revokedAt) return null
  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
  return { id: key.user.id, email: key.user.email }
}

/** The user behind a session cookie, or null when it is unknown or expired. */
export async function userOfSession(token: string): Promise<User | null> {
  const session = await db.session.findUnique({ where: { tokenHash: hashSecret(token) }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) return null
  return { id: session.user.id, email: session.user.email }
}

const SESSION_DAYS = 30

/** Opens a web session for the user; returns the cookie token (only its hash is stored). */
export async function openSession(userId: string) {
  const token = newSecret()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await db.session.create({ data: { userId, tokenHash: hashSecret(token), expiresAt } })
  return { token, maxAge: SESSION_DAYS * 86_400 }
}

export const closeSession = (token: string) => db.session.deleteMany({ where: { tokenHash: hashSecret(token) } })
