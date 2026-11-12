/**
 * GET /entrypoint.md: how an agent sets itself up to use rb. Served with no
 * sign-in, so an agent can read it before it has a key.
 */
export function entrypoint(base: string): string {
  return `# Retroback for agents

Retroback plans backward from a target to the present. You work on it with
\`rb\`, its command line. This page tells you how to set it up once, so that
every later command is short.

Engine API: ${base}

## 1. Install rb

Needs Node 22 or later.

\`\`\`sh
npm install -g github:bigmoostache/retroback
rb help
\`\`\`

Check that it is recent enough: \`rb help\` must list \`rb config\` and mention
\`RB_PLAN\`. If \`--key\` is refused as an unknown flag, your rb is too old:
update it (step 2).

## 2. Update rb

The same command installs the latest build of main over the old one:

\`\`\`sh
npm install -g github:bigmoostache/retroback
\`\`\`

## 3. Configure it once, in a .env file

rb reads three settings. A variable set in the environment wins; otherwise rb
takes the nearest \`.env\` in the current folder or a parent folder; otherwise
\`~/.config/rb/.env\`.

\`\`\`sh
mkdir -p ~/.config/rb
cat > ~/.config/rb/.env <<'EOF'
RB_API=${base}
RB_KEY=rb_...
RB_PLAN=<plan slug>
EOF
rb config        # shows each setting and where it was found
rb user me       # checks the key: prints your email and your plans
\`\`\`

- \`RB_API\`: the engine API, this server.
- \`RB_KEY\`: your API key. Ask your human for one, or create it in the web
  app (Account). It acts as its owner: you see the plans they see.
- \`RB_PLAN\`: the plan you work on. Every command that takes \`--plan\` uses
  it when you leave \`--plan\` out; pass \`--plan <slug>\` to work on another one.
  \`rb plan list\` shows the slugs.

Flags win over settings: \`--api\`, \`--key\`, \`--plan\`. Do not source the
\`.env\` file yourself and do not pass the key on each command: rb reads it.

## 4. Read the full docs first

\`\`\`sh
rb op list
\`\`\`

It prints every command with all its flags, their types and what they do. It
is the reference; \`rb <entity> <verb> --help\` shows one command.

## Good habits

- Add \`--json\` to get the raw answer: \`{"ok": true, "result": ...}\` or
  \`{"ok": false, "error": {"code", "message"}}\`. Exit code 0 on success, 1 on
  error, 3 when \`rb plan check\` finds an error.
- Output is paged. A cut list ends with the command for the next page
  (\`--after <ref>\`). Use \`rb criterion list\`, \`rb requirement list\`,
  \`rb resource list\` and \`rb message list\` rather than whole plans.
- Nodes are addressed by ref (\`N3\`), their items by slug, messages by id
  (\`m-7f3a2c\`). Never by position.
- Build backward: \`rb node create --title ...\` makes the target, then
  \`rb node create --enables N1 ...\` makes what N1 requires. \`rb plan check\`
  checks the 1% rule, criteria and resources. \`rb node unlock --ref N1\`
  says what to tackle now.
- Every change is logged with who made it: \`rb event list\`.

## Without rb

The same operations are at \`POST ${base}/api/<entity>.<verb>\` with a JSON
body and the header \`Authorization: Bearer rb_...\`. \`GET ${base}/api/ops\`
lists them.
`
}
