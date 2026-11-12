import { AsyncLocalStorage } from "node:async_hooks"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, type Prisma } from "./generated/prisma/client.ts"
import { DATABASE_URL } from "./env.ts"

/** One Prisma client per process, shared by the CLI, the API and the seed. */
const base = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
})

const scope = new AsyncLocalStorage<Prisma.TransactionClient>()

/**
 * The client every module uses. Inside `inTransaction`, it is the running
 * transaction instead, so a batch of operations commits all or nothing
 * without passing a client around. A nested `$transaction` joins it.
 */
export const db = new Proxy(base, {
  get(target, prop) {
    const tx = scope.getStore()
    if (tx && prop === "$transaction") {
      return async (arg: unknown) =>
        typeof arg === "function" ? (arg as (t: Prisma.TransactionClient) => Promise<unknown>)(tx) : Promise.all(arg as Promise<unknown>[])
    }
    const source: object = tx ?? target
    const value: unknown = Reflect.get(source, prop)
    return typeof value === "function" ? value.bind(source) : value
  },
}) as PrismaClient

/** Runs `fn` in one database transaction: every write through `db` commits together, or none does. */
export const inTransaction = <T>(fn: () => Promise<T>) =>
  base.$transaction((tx) => scope.run(tx, fn), { maxWait: 10_000, timeout: 120_000 })

export type Db = typeof db
