/**
 * Seeds fake plans, built backward from their target.
 *
 *   pnpm seed               create the seed plans that do not exist yet
 *   pnpm seed <slug>...     delete these seed plans and rebuild them
 *   add --verbose to print each command
 *
 * It only calls operations, the way the CLI and the API do, so everything it
 * does can be typed as the `rb` commands it prints. Only the data is fake.
 * A plain `pnpm seed` never touches an existing plan: edits made in the app stay.
 */
import { db } from "./db.ts"
import { toCommand } from "./flags.ts"
import { runOp } from "./ops/index.ts"
import type { CheckView, NodeStatus, NodeView, PlanSummary } from "./types.ts"

const verbose = process.argv.includes("--verbose")
const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"))
let count = 0

async function run<T>(op: string, input: Record<string, unknown> = {}): Promise<T> {
  const command = toCommand(op, input)
  if (verbose) console.log(command)
  const response = await runOp(op, input, { actor: "seed", via: "seed" })
  if (!response.ok) throw new Error(`${command}\n  ${response.error.message}`)
  count++
  return response.result as T
}

interface SeedNode {
  /** Handle used by `extraDeps`. */
  key?: string
  title: string
  description: string
  criteria: string[]
  /** kind, name, quantity, unit */
  resources: [string, string, number, string][]
  status?: NodeStatus
  /** 0 to 100. Default: a fake value drawn from the title, stable from one seed to the next. */
  size?: number
  /** author, text */
  messages?: [string, string][]
  /** What this node requires: created after it, one step before it. */
  before?: SeedNode[]
}

interface SeedPlan {
  plan: {
    slug: string
    title: string
    target: string
    metric: string
    unit: string
    presentValue: number
    targetValue: number
    gapPercent: number
  }
  root: SeedNode
  /** Links beyond the tree: [node key, key of the former node it also depends on]. */
  extraDeps: [string, string][]
  /** The criterion that ties a node to its level of the metric. */
  levelCriterion: (level: number, isTarget: boolean) => string
}

// ------------------------------------------------------------- demo: a chain

/** From the target (N1) back to the first step after the present (N12). */
const DEMO_NODES: SeedNode[] = [
  {
    title: "12% more orders shipped every week",
    description: "The target: the shop ships 12% more orders than today, and deliveries stay on time.",
    criteria: [
      "Late deliveries stay under 2% of orders over 4 weeks.",
      "Customer satisfaction is 4.5 out of 5 or higher over 4 weeks.",
    ],
    resources: [
      ["human", "packer", 40, "person-days"],
      ["capital", "working capital for stock", 30000, "EUR"],
    ],
  },
  {
    title: "Second packing line at full speed",
    description: "The extra orders can only leave the warehouse if a second line packs them.",
    criteria: [
      "Line 2 packs 45 parcels per hour, measured over 5 days.",
      "Packing errors stay under 0.5% of parcels.",
    ],
    resources: [
      ["machine", "packing line", 1, "unit"],
      ["human", "line operator", 20, "person-days"],
    ],
  },
  {
    title: "Evening carrier pickup added",
    description: "A second pickup each day, so orders placed in the afternoon ship the same day.",
    criteria: [
      "The carrier collects at 18:30 on 5 days out of 5, for 2 weeks.",
      "95% of orders placed before 16:00 ship the same day.",
    ],
    resources: [
      ["capital", "carrier fees", 2400, "EUR"],
      ["human", "logistics lead", 5, "person-days"],
    ],
  },
  {
    title: "Stock alerts on the top 50 products",
    description: "Best sellers never run out: a reorder alert fires before the stock does.",
    criteria: [
      "Out-of-stock rate on the top 50 products stays under 1% over 14 days.",
      "The reorder alert fires at least 7 days before stock runs out.",
    ],
    resources: [
      ["computing", "forecast job", 30, "CPU-hours"],
      ["human", "data analyst", 8, "person-days"],
    ],
  },
  {
    title: "Checkout in 3 steps instead of 5",
    description: "Fewer steps between the cart and the payment, tested against the current checkout.",
    criteria: [
      "Checkout completion reaches 68% (from 64%) over 10000 sessions.",
      "Median checkout time is under 90 seconds.",
    ],
    resources: [
      ["human", "frontend engineer", 12, "person-days"],
      ["human", "designer", 4, "person-days"],
      ["computing", "A/B test platform", 1, "months"],
    ],
  },
  {
    title: "Abandoned-cart emails live",
    description: "A reminder goes to customers who leave with a full cart.",
    criteria: [
      "The email is sent within 60 minutes for 99% of abandoned carts.",
      "8% of the emailed carts are recovered over 3 weeks.",
    ],
    resources: [
      ["human", "CRM specialist", 6, "person-days"],
      ["capital", "email platform", 300, "EUR"],
    ],
  },
  {
    title: "Product pages load in under 2 seconds",
    description: "Slow pages lose visitors before they see the product.",
    criteria: [
      "95th percentile load time on mobile is under 2.0 s over 7 days.",
      "Bounce rate on product pages is under 35%.",
    ],
    resources: [
      ["human", "backend engineer", 10, "person-days"],
      ["computing", "CDN traffic", 500, "GB"],
    ],
  },
  {
    title: "Paid search campaign on the top 20 products",
    description: "Buy traffic only where the product pages already convert.",
    criteria: [
      "Cost per order is under 6 EUR over 2 weeks.",
      "At least 10 extra orders a week are attributed to the campaign.",
    ],
    resources: [
      ["capital", "ad budget", 4000, "EUR"],
      ["human", "marketing manager", 6, "person-days"],
    ],
  },
  {
    title: "Orders tracked by channel",
    description: "Know where each order comes from before spending on any channel.",
    criteria: [
      "100% of orders carry a channel tag, 7 days in a row.",
      "The weekly report is delivered every Monday before 10:00.",
    ],
    resources: [
      ["human", "data analyst", 5, "person-days"],
      ["computing", "analytics warehouse", 20, "CPU-hours"],
    ],
  },
  {
    title: "Returns handled in 48 hours",
    description: "A fast refund brings the customer back for the next order.",
    criteria: [
      "90% of returns are refunded within 48 hours over 3 weeks.",
      "The repeat order rate at 30 days rises to 22%.",
    ],
    resources: [
      ["human", "support agent", 15, "person-days"],
      ["space", "returns desk area", 12, "m2"],
    ],
  },
  {
    title: "Top 50 products photographed and described",
    description: "The best sellers get complete pages first.",
    criteria: [
      "50 of 50 product pages have 4 photos or more.",
      "50 of 50 product pages have a description of 120 words or more.",
    ],
    resources: [
      ["human", "photographer", 3, "person-days"],
      ["machine", "photo studio", 2, "days"],
      ["capital", "copywriting", 800, "EUR"],
    ],
    status: "doing",
  },
  {
    title: "Baseline measured and shared",
    description: "The first step from today: everyone counts weekly orders the same way.",
    criteria: [
      "Weekly orders are measured the same way 3 weeks in a row.",
      "The dashboard is opened by 8 of 8 team leads in one week.",
    ],
    resources: [["human", "operations lead", 2, "person-days"]],
    status: "done",
  },
]

/** Each node requires the next one: a single chain, keyed d1 (target) to d12. */
function chain(nodes: SeedNode[]): SeedNode {
  let next: SeedNode | undefined
  for (let i = nodes.length - 1; i >= 0; i--) next = { ...nodes[i]!, key: `d${i + 1}`, before: next ? [next] : [] }
  return next!
}

const DEMO: SeedPlan = {
  plan: {
    slug: "demo",
    title: "Demo: 12% more weekly orders",
    target: "The shop ships 1120 orders a week, 4 weeks in a row, with deliveries on time.",
    metric: "orders shipped per week",
    unit: "orders",
    presentValue: 1000,
    targetValue: 1120,
    gapPercent: 1,
  },
  root: chain(DEMO_NODES),
  extraDeps: [
    ["d1", "d3"], // the target also needs the evening pickup
    ["d4", "d9"], // stock alerts need orders tracked by channel
    ["d5", "d7"], // the checkout test needs fast pages
    ["d8", "d11"], // the campaign needs complete product pages
  ],
  levelCriterion: (level, isTarget) => `${level} orders are shipped per week, ${isTarget ? 4 : 2} weeks in a row.`,
}

// ------------------------------------------------------------ growth: a tree

/**
 * Three branches (product-led, sales, retention) that split again, 7 leaves.
 * Every leaf sits one step after the present: with a 1% gap from 1000 to 1050,
 * each path from a leaf to the target is 5 nodes long.
 */
const GROWTH_ROOT: SeedNode = {
  key: "target",
  title: "1050 paying customers",
  description: "The target: 5% more paying customers than today, with churn under control.",
  criteria: ["Net revenue retention is 102% or more over the quarter.", "Gross margin stays above 70%."],
  resources: [["human", "revenue operations lead", 10, "person-days"]],
  messages: [
    ["guillaume", "Three ways to get there: trials, outbound, keeping who we have. Which one first?"],
    ["agent-1", "Churn: each point saved counts like 10 new signups at today's rates."],
  ],
  before: [
    {
      key: "trial",
      title: "Free trial converts at 25%",
      description: "Product-led: more trial users become paying customers on their own.",
      criteria: ["25% of trials started in a month convert within 30 days.", "Median time to first value is under 10 minutes."],
      resources: [["human", "product manager", 15, "person-days"]],
      before: [
        {
          key: "onboarding",
          title: "Guided onboarding live",
          description: "New users are walked to the first useful result.",
          criteria: ["70% of new users finish the 4 onboarding steps.", "Support tickets from new users drop by 30%."],
          resources: [
            ["human", "frontend engineer", 15, "person-days"],
            ["human", "designer", 5, "person-days"],
          ],
          before: [
            {
              key: "activation",
              title: "Activation event defined and tracked",
              description: "One event that says a user got value, measured for every account.",
              criteria: [
                "The event predicts conversion with 0.7 correlation or more on 6 months of data.",
                "100% of new accounts report the event within 1 hour.",
              ],
              resources: [["human", "data analyst", 6, "person-days"]],
              before: [
                {
                  key: "sdk",
                  title: "Product analytics SDK installed",
                  description: "The app sends usage events to one place.",
                  criteria: ["20 key events are sent from web and mobile.", "Event loss is under 1% over 7 days."],
                  resources: [
                    ["human", "backend engineer", 5, "person-days"],
                    ["capital", "analytics licence", 6000, "EUR"],
                  ],
                  status: "done",
                },
                {
                  key: "funnel",
                  title: "Signup funnel mapped",
                  description: "Know where people drop between the landing page and the first login.",
                  criteria: ["Drop-off is measured at 6 steps of the funnel.", "The 3 largest drops are named and sized."],
                  resources: [["human", "growth marketer", 4, "person-days"]],
                  status: "doing",
                  messages: [["agent-1", "The biggest drop so far is email confirmation: 31% never click."]],
                },
              ],
            },
          ],
        },
        {
          key: "pricing",
          title: "New pricing page live",
          description: "Clear tiers, a price that matches what users are willing to pay.",
          criteria: ["Visit-to-trial rate on the pricing page reaches 6%.", "3 tiers at most, each with 5 lines or fewer."],
          resources: [
            ["human", "designer", 4, "person-days"],
            ["human", "copywriter", 2, "person-days"],
          ],
          before: [
            {
              key: "pricetest",
              title: "Price test on 2 tiers",
              description: "Two prices shown to new visitors, the winner kept.",
              criteria: ["2000 visitors or more see each price.", "The winner's revenue per visitor is 10% higher or more."],
              resources: [["computing", "A/B test platform", 1, "months"]],
              before: [
                {
                  key: "survey",
                  title: "Willingness-to-pay survey of 200 users",
                  description: "Ask before testing: what price feels too cheap, too expensive.",
                  criteria: ["200 answers or more from active users.", "A price range is set with 4 price points."],
                  resources: [
                    ["capital", "survey incentives", 1000, "EUR"],
                    ["human", "product manager", 3, "person-days"],
                  ],
                  status: "done",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      key: "outbound",
      title: "Outbound team books 40 demos a month",
      description: "Sales-led: reach companies that would not find the product alone.",
      criteria: ["40 demos booked a month, 2 months in a row.", "20% of demos become paying customers."],
      resources: [["capital", "sales tools", 400, "EUR per month"]],
      before: [
        {
          key: "aes",
          title: "2 account executives ramped",
          description: "Two sellers able to close on their own.",
          criteria: ["Each closes 3 deals or more in their 3rd month.", "Both pass the demo certification with 80% or more."],
          resources: [
            ["human", "account executive", 2, "people"],
            ["capital", "salaries for 3 months", 45000, "EUR"],
          ],
          before: [
            {
              key: "playbook",
              title: "Sales playbook written",
              description: "Who to call, what to say, how to answer the 10 usual objections.",
              criteria: ["The playbook covers 10 objections with tested answers.", "5 recorded calls are annotated."],
              resources: [["human", "head of sales", 8, "person-days"]],
              before: [
                {
                  key: "hiring",
                  title: "Hiring pipeline open",
                  description: "Find the account executives before they are needed.",
                  criteria: ["30 candidates screened in 4 weeks.", "2 offers signed by week 6."],
                  resources: [
                    ["capital", "recruiter fee", 12000, "EUR"],
                    ["human", "hiring manager", 6, "person-days"],
                  ],
                },
                {
                  key: "icp",
                  title: "Ideal customer profile defined",
                  description: "Which companies buy fastest and stay longest.",
                  criteria: ["The profile is drawn from 100 current customers.", "500 matching companies are listed."],
                  resources: [["human", "data analyst", 3, "person-days"]],
                  status: "done",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      key: "churn",
      title: "Monthly churn under 2%",
      description: "Retention: keep the customers already won.",
      criteria: ["Logo churn is under 2% for 3 months in a row.", "Exit surveys are answered by 50% of leavers."],
      resources: [["human", "customer success manager", 20, "person-days"]],
      before: [
        {
          key: "health",
          title: "Customer health score live",
          description: "A score that flags accounts likely to leave, early enough to act.",
          criteria: ["The score flags 70% of churned accounts 30 days ahead.", "It is refreshed every 24 hours."],
          resources: [["computing", "scoring job", 40, "CPU-hours"]],
          before: [
            {
              key: "warehouse",
              title: "Usage data in the warehouse",
              description: "Product usage and billing joined per account.",
              criteria: ["100% of accounts have 12 months of usage history.", "Data is less than 24 hours old."],
              resources: [["computing", "data warehouse", 300, "EUR per month"]],
              before: [
                {
                  key: "engineer",
                  title: "Data engineer hired",
                  description: "Someone to build and run the data pipelines.",
                  criteria: ["1 offer signed within 8 weeks.", "The pipeline backlog is estimated in week 2."],
                  resources: [["capital", "salary for 6 months", 40000, "EUR"]],
                },
              ],
            },
          ],
        },
        {
          key: "sla",
          title: "Support answers in 4 hours",
          description: "Slow answers are the first reason given in exit surveys.",
          criteria: ["90% of tickets get a first answer within 4 hours.", "Satisfaction on tickets is 4.5 out of 5 or more."],
          resources: [["human", "support agent", 30, "person-days"]],
          before: [
            {
              key: "helpdesk",
              title: "Help desk tool deployed",
              description: "Tickets in one queue, with timers and routing.",
              criteria: ["100% of support emails land in the tool.", "5 answer templates cover 60% of tickets."],
              resources: [["capital", "help desk licence", 150, "EUR per month"]],
              before: [
                {
                  key: "rota",
                  title: "Support rota of 3 people",
                  description: "Someone is always on the queue during business hours.",
                  criteria: ["3 people share the rota, 5 days a week.", "No gap longer than 1 hour in 2 weeks."],
                  resources: [["human", "support agent", 3, "people"]],
                  status: "doing",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const GROWTH: SeedPlan = {
  plan: {
    slug: "growth",
    title: "Demo: 1050 paying customers",
    target: "1050 customers pay for the product, 2 months in a row, with churn under 2% a month.",
    metric: "paying customers",
    unit: "customers",
    presentValue: 1000,
    targetValue: 1050,
    gapPercent: 1,
  },
  root: GROWTH_ROOT,
  extraDeps: [
    ["outbound", "pricing"], // sellers need the new prices
    ["warehouse", "sdk"], // the warehouse reads the analytics events
  ],
  levelCriterion: (level, isTarget) => `${level} paying customers, ${isTarget ? 2 : 1} months in a row.`,
}

const SEEDS: SeedPlan[] = [DEMO, GROWTH]

// ------------------------------------------------------------------- build

/** A fake size between 15 and 85, always the same for the same title. */
function fakeSize(title: string): number {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return 15 + (hash % 71)
}

async function build(seed: SeedPlan): Promise<boolean> {
  const slug = seed.plan.slug
  const plan = { plan: slug }
  count = 0
  await run("plan.create", seed.plan)

  // Breadth first from the target: refs grow backward, a node always after what it enables.
  const refs = new Map<string, string>()
  const queue: [SeedNode, string | null][] = [[seed.root, null]]
  for (let item = queue.shift(); item; item = queue.shift()) {
    const [node, later] = item
    const created = await run<NodeView>("node.create", {
      ...plan,
      title: node.title,
      description: node.description,
      ...(later ? { enables: [later] } : {}),
      size: node.size ?? fakeSize(node.title),
      criterion: node.criteria,
    })
    if (node.key) refs.set(node.key, created.ref)
    const at = { ...plan, node: created.ref }
    const withLevel = await run<NodeView>("criterion.add", { ...at, text: seed.levelCriterion(created.level, later === null) })
    for (const [kind, name, quantity, unit] of node.resources) {
      await run("resource.add", { ...at, kind, name, quantity, unit })
    }
    for (const [author, text] of node.messages ?? []) await run("message.add", { ...at, author, text })
    for (const before of node.before ?? []) queue.push([before, created.ref])
    if (!node.status) continue
    await run("node.update", { ...plan, ref: created.ref, status: node.status })
    // A node under way has met its first criterion; a done node has met them all.
    const met = node.status === "done" ? withLevel.criteria : withLevel.criteria.slice(0, 1)
    for (const c of met) await run("criterion.update", { ...at, criterion: c.slug, met: true })
  }

  const refOf = (key: string) => {
    const ref = refs.get(key)
    if (!ref) throw new Error(`Seed "${slug}": no node with key "${key}".`)
    return ref
  }
  for (const [node, on] of seed.extraDeps) {
    const former = await run<NodeView>("node.show", { ...plan, ref: refOf(on) })
    await run("requirement.add", { ...plan, node: refOf(node), text: former.title, providedBy: former.ref })
  }

  const check = await run<CheckView>("plan.check", plan)
  const errors = check.issues.filter((issue) => issue.severity === "error")
  console.log(`Plan "${slug}": ${refs.size} nodes, built with ${count} operations.`)
  console.log(`Check: ${check.ok ? "ok" : "failed"} (${errors.length} errors, ${check.issues.length - errors.length} warnings)`)
  for (const issue of check.issues) console.log(`  ${issue.severity}  ${issue.code}  ${issue.message}`)
  console.log(`See it with: rb plan show --plan ${slug}`)
  return check.ok
}

async function seed() {
  const unknown = asked.filter((slug) => !SEEDS.some((s) => s.plan.slug === slug))
  if (unknown.length) {
    throw new Error(`No seed plan ${unknown.join(", ")}. Seed plans: ${SEEDS.map((s) => s.plan.slug).join(", ")}.`)
  }
  const existing = new Set((await run<PlanSummary[]>("plan.list")).map((p) => p.slug))
  let ok = true
  for (const seedPlan of SEEDS) {
    const slug = seedPlan.plan.slug
    if (asked.length && !asked.includes(slug)) continue
    if (existing.has(slug)) {
      if (!asked.includes(slug)) {
        console.log(`Plan "${slug}" exists: kept as is. Rebuild it with: pnpm seed ${slug}`)
        continue
      }
      await run("plan.delete", { plan: slug })
    }
    ok = (await build(seedPlan)) && ok
  }
  return ok ? 0 : 1
}

seed()
  .then((code) => (process.exitCode = code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
