/**
 * rb keeps itself on the latest build of main.
 *
 * At most once a day, the built rb (dist/rb.mjs) compares the sha256 of its
 * own file with rb.sha256 of the "latest" release, which CI publishes on every
 * merge to main. When they differ, it downloads rb.mjs, checks its hash,
 * replaces itself and runs the same command again with the new file.
 *
 * Nothing here ever fails a command: offline, a slow network or a folder it
 * cannot write leave the current rb running as it is. Messages go to stderr,
 * so `--json` output stays clean.
 *
 *   RB_NO_UPDATE=1     never check
 *   RB_UPDATE_URL=...  where rb.mjs and rb.sha256 are (default: the latest release)
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const RELEASE = "https://github.com/bigmoostache/retroback/releases/download/latest"
const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 5000
const INSTALL = "npm install -g github:bigmoostache/retroback"

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex")

function stateFile(): string {
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
  return path.join(cache, "rb", "update.json")
}

/** True once a day: the time of the check is written before checking, so an offline rb does not retry on every call. */
function dueToday(): boolean {
  const file = stateFile()
  try {
    const { checkedAt } = JSON.parse(readFileSync(file, "utf8")) as { checkedAt?: number }
    if (typeof checkedAt === "number" && Date.now() - checkedAt < DAY_MS) return false
  } catch {
    // No state yet, or unreadable: check.
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ checkedAt: Date.now() }))
  } catch {
    // Cannot remember the check: still check, at worst once per call.
  }
  return true
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" })
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

/**
 * Updates rb when a newer build exists, then runs the command again with it.
 * Returns the exit code of that run, or null to carry on with this rb.
 */
export async function selfUpdate(argv: string[]): Promise<number | null> {
  if (process.env.RB_NO_UPDATE === "1") return null
  let self: string
  try {
    self = realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return null
  }
  // Only the built file updates itself; bin/rb runs the sources, which git keeps up to date.
  if (!self.endsWith(".mjs")) return null
  if (!dueToday()) return null

  const base = (process.env.RB_UPDATE_URL || RELEASE).replace(/\/+$/, "")
  const published = (await fetchBytes(`${base}/rb.sha256`))?.toString("utf8").trim().split(/\s+/)[0]
  if (!published || !/^[0-9a-f]{64}$/.test(published)) return null
  if (published === sha256(readFileSync(self))) return null

  try {
    accessSync(path.dirname(self), constants.W_OK)
  } catch {
    console.error(`rb: a newer build exists, but ${path.dirname(self)} is not writable. Update with: ${INSTALL}`)
    return null
  }
  const fresh = await fetchBytes(`${base}/rb.mjs`)
  if (!fresh || sha256(fresh) !== published) return null

  const tmp = `${self}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, fresh)
    chmodSync(tmp, 0o755)
    renameSync(tmp, self)
  } catch {
    try {
      unlinkSync(tmp)
    } catch {
      // Nothing was written.
    }
    console.error(`rb: could not replace ${self}. Update with: ${INSTALL}`)
    return null
  }

  console.error("rb: updated to the latest build of main.")
  const run = spawnSync(process.execPath, [self, ...argv], {
    stdio: "inherit",
    env: { ...process.env, RB_NO_UPDATE: "1" },
  })
  return run.status ?? 1
}
