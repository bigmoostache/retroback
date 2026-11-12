#!/usr/bin/env node

// engine/src/flags.ts
var kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
var camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// engine/src/cli.ts
var DEFAULT_API = "http://127.0.0.1:7979";
var Unreachable = class extends Error {
};
function remoteBackend(base, key) {
  const root = base.replace(/\/+$/, "");
  const auth = key ? { authorization: `Bearer ${key}` } : {};
  const request = async (path, init) => {
    let res;
    try {
      res = await fetch(`${root}/api/${path}`, { ...init, headers: { ...auth, ...init?.headers } });
    } catch {
      throw new Unreachable(`The engine API does not answer at ${root}.`);
    }
    try {
      return await res.json();
    } catch {
      throw new Unreachable(`${root} answered ${res.status} without JSON: is it a Retroback engine API?`);
    }
  };
  return {
    infos: async () => {
      const listed = await request("ops");
      if (!listed.ok) throw new Unreachable(`${root}/api/ops: ${listed.error.message}`);
      return listed.result;
    },
    run: (name, input) => request(name, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })
  };
}
function takeOption(argv, name, example) {
  const rest = [];
  let value;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      if (next === void 0 || next.startsWith("--")) throw new UsageError(`--${name} needs a value, e.g. --${name} ${example}.`);
      value = next;
      i++;
    } else if (arg.startsWith(`--${name}=`)) value = arg.slice(name.length + 3);
    else rest.push(arg);
  }
  return { value, rest };
}
var UsageError = class extends Error {
};
function parseFlags(info, args) {
  const props = info.input.properties ?? {};
  const input = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new UsageError(`Unexpected "${arg}": values are passed as flags.`);
    const eq = arg.indexOf("=");
    const key = camel(eq === -1 ? arg.slice(2) : arg.slice(2, eq));
    const flag = `--${kebab(key)}`;
    const prop = props[key];
    if (!prop) throw new UsageError(`Unknown flag ${flag}.`);
    let raw = eq === -1 ? void 0 : arg.slice(eq + 1);
    if (raw === void 0) {
      const next = args[i + 1];
      if (prop.type === "boolean" && next !== "true" && next !== "false") raw = "true";
      else if (next === void 0) throw new UsageError(`${flag} needs a value.`);
      else {
        raw = next;
        i++;
      }
    }
    let value = raw;
    if (prop.type === "number" || prop.type === "integer") {
      value = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(value)) throw new UsageError(`${flag} must be a number, got "${raw}".`);
    } else if (prop.type === "boolean") {
      if (raw !== "true" && raw !== "false") throw new UsageError(`${flag} must be true or false, got "${raw}".`);
      value = raw === "true";
    }
    if (prop.type === "array") {
      input[key] = [...input[key] ?? [], value];
    } else if (key in input) {
      throw new UsageError(`${flag} is given twice.`);
    } else {
      input[key] = value;
    }
  }
  return input;
}
var num = (n) => String(Number(n.toPrecision(12)));
function table(rows) {
  const widths = [];
  for (const row of rows) row.forEach((cell, i) => widths[i] = Math.max(widths[i] ?? 0, cell.length));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd()).join("\n");
}
var gapText = (gap) => gap.percent === null ? "n/a" : `${gap.percent > 0 ? "+" : ""}${gap.percent}%${gap.ok ? "" : " !"}`;
var box = (met) => met ? "[x]" : "[ ]";
function renderCheck(check) {
  const errors = check.issues.filter((i) => i.severity === "error").length;
  const warnings = check.issues.length - errors;
  const head = `Check: ${check.ok ? "ok" : "failed"} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`;
  if (check.issues.length === 0) return head;
  return [head, table(check.issues.map((i) => [`  ${i.severity}`, i.code, i.message]))].join("\n");
}
function renderNodes(nodes) {
  if (nodes.length === 0) return "No node yet. Create the target with: rb node create --title <text>";
  return table([
    ["REF", "LEVEL", "GAP", "FROM", "STATUS", "SIZE", "TITLE"],
    ...nodes.map((n) => [n.ref, num(n.level), gapText(n.gap), n.gap.from, n.status, String(n.size), n.title])
  ]);
}
function renderNode(n) {
  const list = (title, lines) => [``, title, ...lines.length ? lines.map((l) => `  ${l}`) : ["  (none)"]];
  return [
    `${n.ref}  ${n.title}  [${n.status}]`,
    `level ${num(n.level)}, ${gapText(n.gap)} from ${n.gap.from} (${num(n.gap.base)}), size ${n.size}/100`,
    ...n.description ? ["", n.description] : [],
    ...list("Success criteria", n.criteria.map((c) => `${box(c.met)} ${c.slug}: ${c.text}`)),
    ...list(
      "Requirements",
      n.requirements.map((r) => `${box(r.met)} ${r.slug}: ${r.text}  <- ${r.providedBy}`)
    ),
    ...list("Requires (providers of its requirements)", n.dependsOn.length ? [n.dependsOn.join(", ")] : []),
    ...list("Enables", n.enables.length ? [n.enables.join(", ")] : []),
    ...list("Resources", n.resources.map((r) => `${r.slug}: ${r.kind}, ${r.name}, ${num(r.quantity)} ${r.unit}`)),
    ...list("Messages", n.messages.map(messageLine))
  ].join("\n");
}
var messageLine = (m) => `${m.id}  ${m.author}, ${m.at.slice(0, 16).replace("T", " ")}${m.edited ? " (edited)" : ""}: ${m.text.replace(/\n/g, "\n          ")}`;
var renderMessages = (messages) => messages.length === 0 ? "No message." : messages.map(messageLine).join("\n");
function renderPlan(p) {
  return [
    `${p.slug}  ${p.title}`,
    `Target: ${p.target}`,
    `${p.metric}: ${num(p.presentValue)} -> ${num(p.targetValue)} ${p.unit}, steps of ${num(p.gapPercent)}% at most`,
    "",
    renderNodes(p.nodes),
    ...p.resources.length ? [
      "",
      "Resources",
      table(p.resources.map((r) => [`  ${r.kind}`, r.name, `${num(r.quantity)} ${r.unit}`, r.nodes.join(", ")]))
    ] : [],
    "",
    renderCheck(p.check)
  ].join("\n");
}
var renderPlans = (plans) => plans.length === 0 ? "No plan yet. Create one with: rb plan create" : table([
  ["SLUG", "NODES", "METRIC", "TITLE"],
  ...plans.map((p) => [
    p.slug,
    String(p.nodeCount),
    `${p.metric} ${num(p.presentValue)} -> ${num(p.targetValue)} ${p.unit}`,
    p.title
  ])
]);
function renderOps(infos) {
  const lines = [];
  let entity = "";
  for (const info of infos) {
    const [head] = info.name.split(".");
    if (head !== entity) {
      if (entity) lines.push("");
      entity = head;
    }
    lines.push(info.cli, `    ${info.summary}`);
  }
  return lines.join("\n");
}
function renderOpHelp(info) {
  const required = new Set(info.input.required ?? []);
  const rows = Object.entries(info.input.properties ?? {}).map(([key, prop]) => [
    `  --${kebab(key)}`,
    prop.enum ? prop.enum.join("|") : prop.type === "array" ? "text" : prop.type ?? "text",
    required.has(key) ? "required" : prop.type === "array" ? "repeatable" : "",
    prop.description ?? ""
  ]);
  return [info.summary, "", info.cli, ...rows.length ? ["", table(rows)] : []].join("\n");
}
function render(name, result) {
  if (name === "message.list") return renderMessages(result);
  if (name === "user.me") {
    const me = result;
    return [`${me.email}${me.name ? `  (${me.name})` : ""}`, ...me.plans.map((p) => `  ${p.plan}  ${p.role}`)].join("\n");
  }
  if (name === "plan.members" || name === "plan.share" || name === "plan.unshare") {
    return table([["EMAIL", "ROLE", "NAME"], ...result.map((m) => [m.email, m.role, m.name])]);
  }
  if (name === "key.list") {
    const keys = result;
    if (keys.length === 0) return "No API key. Create one with: rb key create --name <name>";
    return table([
      ["NAME", "PREFIX", "CREATED", "LAST USED", "STATE"],
      ...keys.map((k) => [k.name, k.prefix, k.createdAt.slice(0, 16).replace("T", " "), k.lastUsedAt?.slice(0, 16).replace("T", " ") ?? "never", k.revoked ? "revoked" : "active"])
    ]);
  }
  if (name === "key.create") {
    const k = result;
    return [`Key "${k.name}" created. Its secret, shown only now:`, "", `  ${k.secret}`, "", "Use it with: export RB_KEY=<secret>"].join("\n");
  }
  if (name === "key.revoke") return `Key "${result.name}" revoked.`;
  if (name === "event.list") {
    const events = result;
    if (events.length === 0) return "No event.";
    return table([
      ["SEQ", "AT", "ACTOR", "VIA", "OP", "PLAN", "RESULT"],
      ...events.map((e) => [
        String(e.seq),
        e.at.slice(0, 19).replace("T", " "),
        e.actor,
        e.via,
        e.op,
        e.plan ?? "",
        e.ok ? "ok" : e.error ?? "error"
      ])
    ]);
  }
  if (name === "event.replay") {
    const r = result;
    const head = `Replayed ${r.replayed} events of "${r.from}" into "${r.as}", up to event ${r.upTo}.`;
    return r.plan ? [head, "", renderPlan(r.plan)].join("\n") : `${head}
The history ends with the plan deleted.`;
  }
  if (name === "node.unlock") {
    const u = result;
    if (u.nodes.length === 0) return `Nothing to unlock: ${u.target} is done.`;
    return [`To reach ${u.target}, tackle now:`, renderNodes(u.nodes), "", `Size left: ${u.size} (heaviest path, perfect parallelism)`].join("\n");
  }
  if (Array.isArray(result)) {
    const first = result[0];
    if (!first) {
      if (name === "plan.list") return renderPlans([]);
      if (name === "node.list") return renderNodes([]);
      return "(nothing)";
    }
    if ("cli" in first) return renderOps(result);
    if ("nodeCount" in first) return renderPlans(result);
    if ("ref" in first) return renderNodes(result);
  } else if (result && typeof result === "object") {
    if ("nodes" in result) return renderPlan(result);
    if ("ref" in result) return renderNode(result);
    if ("issues" in result) return renderCheck(result);
    if ("deleted" in result) return `Deleted ${String(result.deleted)}.`;
  }
  return JSON.stringify(result, null, 2);
}
var overview = (infos) => [
  "rb: plan backward from a target to the present.",
  "",
  "  rb <entity> <verb> [--flag value]...",
  "  rb <entity> <verb> --help",
  "  add --json to get the raw response",
  `  add --api <url> (or set RB_API) to pick the engine API, default ${DEFAULT_API}`,
  "  add --key <rb_...> (or set RB_KEY): your API key, from the web app or rb key create",
  "",
  renderOps(infos)
].join("\n");
async function main() {
  const raw = process.argv.slice(2);
  const json = raw.includes("--json");
  const fail = (code, message) => {
    if (json) console.log(JSON.stringify({ ok: false, error: { code, message } }, null, 2));
    else console.error(`error: ${message}`);
    return 1;
  };
  let argv;
  let api;
  let key;
  try {
    const a = takeOption(raw, "api", DEFAULT_API);
    const k = takeOption(a.rest, "key", "rb_...");
    ({ value: api } = a);
    ({ value: key, rest: argv } = k);
  } catch (error) {
    if (error instanceof UsageError) return fail("invalid", error.message);
    throw error;
  }
  api ??= process.env.RB_API || DEFAULT_API;
  key ??= process.env.RB_KEY || void 0;
  if (!/^https?:\/\/[^/\s]+/.test(api)) return fail("invalid", `--api must be an http(s) URL, got "${api}".`);
  const backend = remoteBackend(api, key);
  try {
    return await runCli(argv, json, backend, fail);
  } catch (error) {
    if (error instanceof Unreachable) return fail("unreachable", error.message);
    throw error;
  }
}
async function runCli(argv, json, backend, fail) {
  const help = argv.includes("--help") || argv.includes("-h");
  const args = argv.filter((a) => a !== "--json" && a !== "--help" && a !== "-h");
  const infos = await backend.infos();
  const words = [];
  while (words.length < 2 && args[0] !== void 0 && !args[0].startsWith("-")) words.push(args.shift());
  if (words.length === 0 || words[0] === "help") {
    console.log(overview(infos));
    return 0;
  }
  const name = words.join(".");
  const info = infos.find((i) => i.name === name);
  if (!info) {
    const verbs = infos.filter((i) => i.name.startsWith(`${words[0]}.`)).map((i) => i.name.split(".")[1]);
    return fail(
      "not_found",
      verbs.length ? `No command "rb ${words.join(" ")}". For ${words[0]}: ${verbs.join(", ")}.` : `No command "rb ${words.join(" ")}". List them with: rb help`
    );
  }
  if (help) {
    console.log(renderOpHelp(info));
    return 0;
  }
  let input;
  try {
    input = parseFlags(info, args);
  } catch (error) {
    if (error instanceof UsageError) return fail("invalid", `${error.message} Usage: ${info.cli}`);
    throw error;
  }
  const response = await backend.run(name, input);
  if (!response.ok) return fail(response.error.code, response.error.message);
  console.log(json ? JSON.stringify(response, null, 2) : render(name, response.result));
  return name === "plan.check" && !response.result.ok ? 3 : 0;
}
main().then((code) => process.exitCode = code).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
