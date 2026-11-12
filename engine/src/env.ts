/** Local dev defaults. Override with environment variables. */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://retroback:retroback@127.0.0.1:55440/retroback"

export const API_PORT = Number(process.env.RETROBACK_API_PORT ?? 7979)
