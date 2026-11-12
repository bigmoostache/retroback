import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "./generated/prisma/client.ts"
import { DATABASE_URL } from "./env.ts"

/** One Prisma client per process, shared by the CLI, the API and the seed. */
export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
})

export type Db = typeof db
