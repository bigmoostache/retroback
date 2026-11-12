import type { ReactNode } from "react"
import { Check, LockOpen, Pencil, Plus, Trash2, X } from "lucide-react"
import { unlock, unlockSize } from "@engine/graph.ts"
import type { CheckItem, NodeStatus, NodeView, PlanView } from "@engine/types.ts"
import { CommandHint } from "@/components/ops/CommandLine"
import { StatusBadge } from "@/components/plan/StatusBadge"
import { SelectionPill } from "@/components/shell/chrome/SelectionPill"
import { IconAction } from "@/components/ui/IconAction"
import { toCommand } from "@/lib/api"
import { gapText, num } from "@/lib/format"
import {
  criterionAdd,
  criterionUpdate,
  itemRemove,
  messageAdd,
  messageRemove,
  messageUpdate,
  nodeDelete,
  nodeUpdate,
  requirementAdd,
  requirementUpdate,
  resourceAdd,
  resourceRemove,
  resourceUpdate,
  type Ask,
} from "@/lib/requests"
import type { Engine } from "@/lib/useEngine"
import { cn } from "@/lib/utils"

const STATUSES: NodeStatus[] = ["todo", "doing", "done"]

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
/** When a message was posted, in the reader's time zone. */
const when = (iso: string) => DATE.format(new Date(iso))

function StatusSwitch({ status, onChange }: { status: NodeStatus; onChange: (status: NodeStatus) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Status"
      className="relative ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-(--border-strong) bg-muted/60 p-1"
    >
      <SelectionPill selectedKey={status} className="rounded-md" />
      {STATUSES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === status}
          data-selected={value === status}
          onClick={() => {
            if (value !== status) onChange(value)
          }}
          className={cn(
            "relative flex h-6 items-center rounded-md px-2 text-subhead font-medium transition-colors duration-base",
            value === status ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

function Section({
  title,
  count,
  note,
  empty,
  add,
  action,
  children,
}: {
  title: string
  count: number
  note?: string | undefined
  empty: string
  add?: { label: string; command: string; run: () => void } | undefined
  action?: ReactNode | undefined
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-6 items-center gap-2">
        <h3 className="text-callout font-semibold text-foreground">{title}</h3>
        <span className="text-subhead text-muted-foreground/50 tabular-nums">{count}</span>
        {note && (
          <span data-section-note className="font-mono text-subhead text-muted-foreground tabular-nums">
            {note}
          </span>
        )}
        {action && <span className="ml-auto flex">{action}</span>}
        {add && (
          <span className="ml-auto flex">
            <IconAction label={add.label} command={add.command} icon={Plus} side="left" onClick={add.run} />
          </span>
        )}
      </div>
      {count === 0 ? (
        <p className="text-body text-muted-foreground/70">{empty}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">{children}</ul>
      )}
    </section>
  )
}

/** Success criteria: tick one, reword it, remove it, add one. */
function Criteria({
  items,
  node,
  run,
  ask,
}: {
  items: CheckItem[]
  node: NodeView
  run: Engine["run"]
  ask: Ask
}) {
  return (
    <Section
      title="Success criteria"
      count={items.length}
      empty="None. A node needs at least one, with a figure."
      add={{ label: "Add a criterion", command: "rb criterion add", run: () => ask(criterionAdd(node)) }}
    >
      {items.map((item) => (
        <li key={item.slug} data-criterion={item.slug} className="flex items-start gap-2 px-2 py-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={item.met}
            aria-label={`criterion ${item.slug} met`}
            onClick={() =>
              void run("criterion.update", { plan: node.plan, node: node.ref, criterion: item.slug, met: !item.met })
            }
            className={cn(
              "mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm border border-(--border-strong) transition-colors",
              item.met && "border-transparent bg-ok text-on-solid",
            )}
          >
            {item.met && <Check className="size-3" />}
          </button>
          <span className={cn("min-w-0 flex-1 text-body", item.met ? "text-muted-foreground" : "text-foreground/90")}>
            {item.text}
          </span>
          <IconAction
            label="Edit"
            command="rb criterion update"
            icon={Pencil}
            onClick={() => ask(criterionUpdate(node, item))}
          />
          <IconAction
            label="Remove"
            command="rb criterion remove"
            icon={X}
            onClick={() => ask(itemRemove("criterion", node, item))}
          />
        </li>
      ))}
    </Section>
  )
}

/** One node: what it is, what proves it, what it needs (`rb node show`). */
export function NodeDetail({
  node,
  plan,
  run,
  ask,
  onSelect,
  unlockOf,
  onUnlock,
}: {
  node: NodeView
  plan: PlanView
  run: Engine["run"]
  ask: Ask
  onSelect: (ref: string) => void
  unlockOf: string | null
  onUnlock: (ref: string | null) => void
}) {
  const titleOf = (ref: string) => plan.nodes.find((n) => n.ref === ref)?.title ?? ""
  const prereqs = new Map(plan.nodes.map((n) => [n.ref, n.dependsOn]))
  // Same answer as `rb node unlock`: both run graph.ts on the same links.
  const unlocked = unlock(plan.nodes, prereqs, node.ref)
  const sizeLeft = unlockSize(plan.nodes, prereqs, node.ref)
  const link = (ref: string) => (
    <button
      type="button"
      onClick={() => onSelect(ref)}
      className="w-9 shrink-0 text-left font-mono text-subhead text-interactive hover:underline"
    >
      {ref}
    </button>
  )

  return (
    <aside className="card-shadow flex w-96 shrink-0 flex-col overflow-hidden rounded-2xl bg-surface-2">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <header className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <code className="mt-1 shrink-0 font-mono text-subhead text-muted-foreground">{node.ref}</code>
            <h2 className="min-w-0 flex-1 text-title3 font-semibold tracking-tight text-foreground">{node.title}</h2>
            <IconAction label="Edit the node" command="rb node update" icon={Pencil} onClick={() => ask(nodeUpdate(node))} />
            <IconAction
              label="Delete the node"
              command="rb node delete"
              icon={Trash2}
              onClick={() => ask(nodeDelete(node))}
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-col font-mono text-subhead tabular-nums">
              <span className="text-foreground">
                {num(node.level)} {plan.unit}
              </span>
              <span className={node.gap.ok ? "text-ok" : "text-danger"}>
                {gapText(node.gap)} from {node.gap.from} ({num(node.gap.base)})
              </span>
              <span className="text-muted-foreground">size {node.size}/100</span>
            </div>
            <StatusSwitch
              status={node.status}
              onChange={(status) => void run("node.update", { plan: node.plan, ref: node.ref, status })}
            />
          </div>
          {node.description && <p className="text-body text-muted-foreground">{node.description}</p>}
        </header>

        <Criteria items={node.criteria} node={node} run={run} ask={ask} />

        <Section
          title="Requirements"
          count={node.requirements.length}
          empty="None: it starts from the present."
          add={{ label: "Add a requirement", command: "rb requirement add", run: () => ask(requirementAdd(node)) }}
        >
          {node.requirements.map((item) => (
            <li key={item.slug} data-requirement={item.slug} className="flex items-start gap-2 px-2 py-1">
              <span
                role="img"
                aria-label={item.met ? "met" : "not met"}
                title={`Met once ${item.providedBy} is done`}
                className={cn(
                  "mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm border border-(--border-strong)",
                  item.met && "border-transparent bg-ok text-on-solid",
                )}
              >
                {item.met && <Check className="size-3" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-body", item.met ? "text-muted-foreground" : "text-foreground/90")}>
                  {item.text}
                </span>
                <span className="flex items-center gap-x-2 text-subhead text-muted-foreground">
                  provided by {link(item.providedBy)}
                </span>
              </span>
              <IconAction
                label="Edit, or change who provides it"
                command="rb requirement update"
                icon={Pencil}
                onClick={() => ask(requirementUpdate(node, item))}
              />
              <IconAction
                label="Remove"
                command="rb requirement remove"
                icon={X}
                onClick={() => ask(itemRemove("requirement", node, item))}
              />
            </li>
          ))}
        </Section>

        <Section
          title="Unlock now"
          count={unlocked.length}
          note={unlocked.length > 0 ? `size left ${sizeLeft}` : undefined}
          empty={node.status === "done" ? "Nothing: the node is done." : "Nothing."}
          action={
            unlocked.length > 0 ? (
              <IconAction
                label={unlockOf === node.ref ? "Hide on the graph" : "Highlight on the graph"}
                command={`rb node unlock --ref ${node.ref}`}
                icon={LockOpen}
                side="left"
                onClick={() => onUnlock(unlockOf === node.ref ? null : node.ref)}
              />
            ) : undefined
          }
        >
          {unlocked.map((n) => (
            <li key={n.ref} data-unlock={n.ref} className="flex items-center gap-2 px-2 py-1">
              {link(n.ref)}
              <span className="min-w-0 flex-1 truncate text-body text-foreground/90">{n.title}</span>
              <StatusBadge status={n.status} />
            </li>
          ))}
        </Section>

        <Section title="Requires" count={node.dependsOn.length} empty="Nothing: it starts from the present.">
          {node.dependsOn.map((ref) => (
            <li key={ref} className="flex items-center gap-2 px-2 py-1">
              {link(ref)}
              <span className="min-w-0 flex-1 truncate text-body text-foreground/90">{titleOf(ref)}</span>
            </li>
          ))}
        </Section>

        <Section title="Enables" count={node.enables.length} empty="No later node.">
          {node.enables.map((ref) => (
            <li key={ref} className="flex items-center gap-2 px-2 py-1">
              {link(ref)}
              <span className="min-w-0 flex-1 truncate text-body text-foreground/90">{titleOf(ref)}</span>
            </li>
          ))}
        </Section>

        <Section
          title="Resources"
          count={node.resources.length}
          empty="None."
          add={{ label: "Add a resource", command: "rb resource add", run: () => ask(resourceAdd(node)) }}
        >
          {node.resources.map((resource) => (
            <li key={resource.slug} data-resource={resource.slug} className="flex items-start gap-2 px-2 py-1">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-foreground/90">{resource.name}</span>
                <span className="text-subhead text-muted-foreground">
                  {resource.kind},{" "}
                  <span className="font-mono tabular-nums">
                    {num(resource.quantity)} {resource.unit}
                  </span>
                </span>
              </span>
              <IconAction
                label="Edit"
                command="rb resource update"
                icon={Pencil}
                onClick={() => ask(resourceUpdate(node, resource))}
              />
              <IconAction
                label="Remove"
                command="rb resource remove"
                icon={X}
                onClick={() => ask(resourceRemove(node, resource))}
              />
            </li>
          ))}
        </Section>

        <Section
          title="Messages"
          count={node.messages.length}
          empty="No message yet."
          add={{ label: "Post a message", command: "rb message add", run: () => ask(messageAdd(node)) }}
        >
          {node.messages.map((message) => (
            <li key={message.id} data-message={message.id} className="flex items-start gap-2 px-2 py-1">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-2 text-subhead">
                  <span className="truncate font-medium text-foreground">{message.author}</span>
                  <time dateTime={message.at} title={message.at} className="shrink-0 text-muted-foreground tabular-nums">
                    {when(message.at)}
                  </time>
                  {message.edited && <span className="shrink-0 text-muted-foreground/60">edited</span>}
                </span>
                <span className="text-body break-words whitespace-pre-wrap text-foreground/90">{message.text}</span>
              </span>
              <IconAction
                label="Edit"
                command="rb message update"
                icon={Pencil}
                onClick={() => ask(messageUpdate(node, message))}
              />
              <IconAction
                label="Remove"
                command="rb message remove"
                icon={X}
                onClick={() => ask(messageRemove(node, message))}
              />
            </li>
          ))}
        </Section>

        <CommandHint command={toCommand("node.show", { plan: node.plan, ref: node.ref })} />
      </div>
    </aside>
  )
}
