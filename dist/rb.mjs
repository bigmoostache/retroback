#!/usr/bin/env node

// engine/src/cli.ts
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

// engine/src/flags.ts
var kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
var camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// engine/src/summary.ts
var tally = (items) => ({ total: items.length, met: items.filter((i) => i.met).length });
var summariseNode = (n) => ({
  plan: n.plan,
  ref: n.ref,
  seq: n.seq,
  title: n.title,
  level: n.level,
  status: n.status,
  size: n.size,
  gap: n.gap,
  dependsOn: n.dependsOn,
  enables: n.enables,
  criteria: tally(n.criteria),
  requirements: tally(n.requirements),
  resources: n.resources.length,
  messages: n.messages.length
});

// engine/src/cli.ts
var DEFAULT_API = "http://127.0.0.1:7979";
var SETTINGS = ["RB_API", "RB_KEY", "RB_PLAN"];
function envFiles() {
  const files = [];
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    files.push(path.join(dir, ".env"));
    if (path.dirname(dir) === dir) break;
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  files.push(path.join(config, "rb", ".env"));
  return files.filter((file, i) => files.indexOf(file) === i && existsSync(file));
}
function readSettings() {
  const out = {};
  for (const name of SETTINGS) {
    if (process.env[name] !== void 0) out[name] = { value: process.env[name] || void 0, from: "environment" };
  }
  for (const file of envFiles()) {
    let parsed;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const name of SETTINGS) {
      if (!out[name] && parsed[name] !== void 0) out[name] = { value: parsed[name] || void 0, from: file };
    }
  }
  for (const name of SETTINGS) out[name] ??= { value: void 0, from: "not set" };
  return out;
}
var Unreachable = class extends Error {
};
function remoteBackend(base, key) {
  const root = base.replace(/\/+$/, "");
  const auth = key ? { authorization: `Bearer ${key}` } : {};
  const request = async (path2, init) => {
    let res;
    try {
      res = await fetch(`${root}/api/${path2}`, { ...init, headers: { ...auth, ...init?.headers } });
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
  if (nodes.length === 0) return "No node.";
  return table([
    ["REF", "LEVEL", "GAP", "FROM", "STATUS", "SIZE", "CRIT", "REQ", "TITLE"],
    ...nodes.map((n) => [
      n.ref,
      num(n.level),
      gapText(n.gap),
      n.gap.from,
      n.status,
      String(n.size),
      `${n.criteria.met}/${n.criteria.total}`,
      `${n.requirements.met}/${n.requirements.total}`,
      clip(n.title, 60)
    ])
  ]);
}
function renderPage(page, command) {
  if (page.total === 0) return "No node. Create the target with: rb node create --title <text>";
  const lines = [renderNodes(page.nodes)];
  if (page.next) {
    lines.push("", `${page.nodes.length} of ${page.total} shown. Next page: ${command} --after ${page.next}`);
  }
  return lines.join("\n");
}
var clip = (s, max) => {
  const line = s.replace(/\s+/g, " ");
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
};
var NODE_MESSAGES = 5;
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
    ...list(
      n.messages.length > NODE_MESSAGES ? `Messages (last ${NODE_MESSAGES} of ${n.messages.length}; all: rb message list --plan ${n.plan} --node ${n.ref} --last ${n.messages.length})` : "Messages",
      n.messages.slice(-NODE_MESSAGES).map(messageLine)
    )
  ].join("\n");
}
var messageLine = (m) => `${m.id}  ${m.author}, ${m.at.slice(0, 16).replace("T", " ")}${m.edited ? " (edited)" : ""}: ${m.text.replace(/\n/g, "\n          ")}`;
function renderMessages(page) {
  if (page.total === 0) return "No message.";
  const lines = page.messages.map(messageLine);
  if (page.messages.length < page.total) {
    lines.unshift(`Last ${page.messages.length} of ${page.total}. More: --last ${page.total}`, "");
  }
  return lines.join("\n");
}
var renderResourceTotals = (resources) => resources.length === 0 ? "No resource." : table([
  ["KIND", "NAME", "QUANTITY", "NODES"],
  ...resources.map((r) => [r.kind, r.name, `${num(r.quantity)} ${r.unit}`, r.nodes.join(", ")])
]);
var planHead = (p) => [
  `${p.slug}  ${p.title}`,
  `Target: ${p.target}`,
  `${p.metric}: ${num(p.presentValue)} -> ${num(p.targetValue)} ${p.unit}, steps of ${num(p.gapPercent)}% at most`
];
function renderPlan(p) {
  return [
    ...planHead(p),
    "",
    renderNodes(p.nodes.map(summariseNode)),
    ...p.resources.length ? ["", "Resources", renderResourceTotals(p.resources)] : [],
    "",
    renderCheck(p.check)
  ].join("\n");
}
function renderBrief(p) {
  const { errors, warnings } = p.check;
  return [
    ...planHead(p),
    "",
    renderPage(p.nodes, `rb plan show --plan ${p.slug}`),
    "",
    `Check: ${p.check.ok ? "ok" : "failed"} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}). Details: rb plan check --plan ${p.slug}`,
    `Resources: rb resource list --plan ${p.slug}`
  ].join("\n");
}
function renderItems(name, list) {
  if (list.items.length === 0) return `${list.node} has none.`;
  if (name === "requirement.list") {
    return table([
      ["MET", "SLUG", "PROVIDED BY", "TEXT"],
      ...list.items.map((r) => [box(r.met), r.slug, r.providedBy, clip(r.text, 80)])
    ]);
  }
  if (name === "resource.list") {
    return table([
      ["SLUG", "KIND", "NAME", "QUANTITY"],
      ...list.items.map((r) => [r.slug, r.kind, r.name, `${num(r.quantity)} ${r.unit}`])
    ]);
  }
  return table([["MET", "SLUG", "TEXT"], ...list.items.map((c) => [box(c.met), c.slug, clip(c.text, 80)])]);
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
  if (name === "op.list") return [SETTINGS_HELP, "", ...result.map((info) => `## rb ${info.name.replace(".", " ")}
${renderOpHelp(info)}`)].join("\n\n");
  if (name === "message.list") return renderMessages(result);
  if (name === "node.list") {
    const page = result;
    return renderPage(page, `rb node list --plan ${page.plan}`);
  }
  if (name === "criterion.list" || name === "requirement.list") return renderItems(name, result);
  if (name === "resource.list") {
    return "items" in result ? renderItems(name, result) : renderResourceTotals(result.resources);
  }
  if (name === "plan.show" || name === "plan.create" || name === "plan.update") {
    const p = result;
    return Array.isArray(p.nodes) ? renderPlan(p) : renderBrief(p);
  }
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
    return r.plan ? [head, "", renderBrief(r.plan)].join("\n") : `${head}
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
      return "(nothing)";
    }
    if ("cli" in first) return renderOps(result);
    if ("nodeCount" in first) return renderPlans(result);
  } else if (result && typeof result === "object") {
    if ("ref" in result) return renderNode(result);
    if ("issues" in result) return renderCheck(result);
    if ("deleted" in result) return `Deleted ${String(result.deleted)}.`;
  }
  return JSON.stringify(result, null, 2);
}
var SETTINGS_HELP = [
  "Settings, read from the environment, else the nearest .env (current folder or above), else ~/.config/rb/.env:",
  `  RB_API   the engine API, default ${DEFAULT_API}          (flag --api)`,
  "  RB_KEY   your API key rb_..., from the web app or rb key create   (flag --key)",
  "  RB_PLAN  the plan used when --plan is left out           (flag --plan)",
  "rb config shows what was found, and where. Add --json to any command for the raw answer."
].join("\n");
var overview = (infos) => [
  "rb: plan backward from a target to the present.",
  "",
  "  rb <entity> <verb> [--flag value]...",
  "  rb <entity> <verb> --help     the flags of one command",
  "  rb op list                    every command with all its flags",
  "",
  SETTINGS_HELP,
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
  const settings = readSettings();
  if (api !== void 0) settings.RB_API = { value: api, from: "--api" };
  if (key !== void 0) settings.RB_KEY = { value: key, from: "--key" };
  if (!settings.RB_API.value) settings.RB_API = { value: DEFAULT_API, from: "default" };
  api = settings.RB_API.value;
  key = settings.RB_KEY.value;
  if (argv.filter((a) => a !== "--json")[0] === "config") {
    const shown = {
      RB_API: settings.RB_API,
      RB_KEY: { ...settings.RB_KEY, value: key ? `${key.slice(0, 7)}\u2026` : void 0 },
      RB_PLAN: settings.RB_PLAN
    };
    if (json) console.log(JSON.stringify({ ok: true, result: shown }, null, 2));
    else {
      console.log(table(Object.entries(shown).map(([name, s]) => [name, s.value ?? "(none)", s.from])));
      console.log(["", "Files read, nearest first:", ...envFiles().map((f) => `  ${f}`) || [], ...envFiles().length ? [] : ["  (none)"]].join("\n"));
    }
    return 0;
  }
  if (!/^https?:\/\/[^/\s]+/.test(api)) return fail("invalid", `RB_API (${settings.RB_API.from}) must be an http(s) URL, got "${api}".`);
  const backend = remoteBackend(api, key);
  try {
    return await runCli(argv, json, backend, fail, settings.RB_PLAN.value);
  } catch (error) {
    if (error instanceof Unreachable) return fail("unreachable", error.message);
    throw error;
  }
}
async function runCli(argv, json, backend, fail, defaultPlan) {
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
  const planProp = info.input.properties?.["plan"];
  if (defaultPlan && planProp && !(info.input.required ?? []).includes("plan") && input["plan"] === void 0) {
    input["plan"] = defaultPlan;
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
