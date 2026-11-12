/**
 * Builds a large throwaway plan and times what the graph view needs:
 * `pnpm --filter engine exec tsx src/bench.ts [nodes=30000]`.
 *
 * The plan (slug `bench-<n>`) is written straight to the database, then
 * loadPlan and the graph helpers are timed. It is kept so the web app can be
 * tried on it; `--drop` deletes it.
 */
import { performance } from "node:perf_hooks"
import { db } from "./db.ts"
import { reducedLinks } from "./graph.ts"
import { graphOf, loadPlan } from "./views.ts"

const n = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 30_000)
const slug = `bench-${n}`

async function build() {
  await db.plan.deleteMany({ where: { slug } })
  const plan = await db.plan.create({
    data: { slug, title: `Bench ${n}`, target: "Scale.", metric: "score", unit: "pts", presentValue: 1000, targetValue: 1000 * 1.01 ** 60 },
  })
  // Deterministic pseudo-random, so runs compare.
  let seed = 42
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31)
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `${slug}-${i + 1}`,
    planId: plan.id,
    ref: `N${i + 1}`,
    seq: i + 1,
    title: `Node ${i + 1}`,
    level: plan.targetValue / 1.01 ** Math.min(59, Math.floor((i * 60) / n)),
    size: 1 + (i % 100),
    duration: 1 + (i % 7),
    status: (rand() < 0.1 ? "done" : "todo") as "done" | "todo",
  }))
  for (let i = 0; i < n; i += 5000) await db.node.createMany({ data: nodes.slice(i, i + 5000) })
  // Node k requires 1 to 3 nodes created after it (further back in time), close to it.
  const reqs: { nodeId: string; slug: string; position: number; text: string; providerId: string }[] = []
  for (let k = 1; k < n; k++) {
    const count = 1 + Math.floor(rand() * 3)
    const providers = new Set<number>()
    for (let j = 0; j < count; j++) providers.add(Math.min(n, k + 1 + Math.floor(rand() * 40)))
    let p = 0
    for (const provider of providers) {
      p++
      reqs.push({ nodeId: `${slug}-${k}`, slug: `r${p}`, position: p, text: `From N${provider}`, providerId: `${slug}-${provider}` })
    }
  }
  for (let i = 0; i < reqs.length; i += 5000) await db.requirement.createMany({ data: reqs.slice(i, i + 5000) })
  const crit = nodes.map((node) => ({ nodeId: node.id, slug: "c", position: 1, text: "Score holds 2 weeks." }))
  for (let i = 0; i < crit.length; i += 5000) await db.criterion.createMany({ data: crit.slice(i, i + 5000) })
  return reqs.length
}

const time = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  const t = performance.now()
  const out = await fn()
  console.log(`${label.padEnd(28)} ${Math.round(performance.now() - t)} ms`)
  return out
}

async function main() {
  if (process.argv.includes("--drop")) {
    await db.plan.deleteMany({ where: { slug } })
    return
  }
  if (!process.argv.includes("--reuse") || !(await db.plan.findUnique({ where: { slug } }))) {
    const links = await time(`build ${n} nodes`, build)
    console.log(`links ${links}`)
  }
  const view = await time("loadPlan", () => loadPlan(slug))
  await time("JSON size", () => console.log(`  ${(JSON.stringify(view).length / 1e6).toFixed(1)} MB`))
  await time("plan.graph size", () => console.log(`  ${(JSON.stringify(graphOf(view)).length / 1e6).toFixed(1)} MB`))
  await time("reducedLinks", () => reducedLinks(new Map(view.nodes.map((x) => [x.ref, x.dependsOn]))))
  console.log(`check: ${view.check.issues.length} issues`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
