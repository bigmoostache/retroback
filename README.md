# Retroback

Plan backward from a target to the present.

A plan fixes one metric, its value today and the value aimed at. You create the
target first, then go backward: each new node is what a later node requires.
Each step stays within a small gap (1% by default): small steps, each one
reachable from the one before.

Every node has a title, a description, precise success criteria, requirements
(each one provided by exactly one earlier node), resources of any kind,
a size from 0 to 100, and messages. Requirements make the graph, which
always stays free of loops.

The same operations drive the CLI (`rb`), the HTTP API and the web app, so
anything one can do, the others can too. `pnpm check:isometry` checks it.

## Install the CLI

```sh
npm install -g github:bigmoostache/retroback
rb help
```

`rb` always talks to an engine API, signed in with an API key:

```sh
export RB_API=http://host:7979      # default http://127.0.0.1:7979
export RB_KEY=rb_...                # from the web app, or: rb key create --name laptop
rb plan list
```

`--api` and `--key` win over `RB_API` and `RB_KEY`. Add `--json` to any command for the raw answer.
`rb` never touches the database, so access checks and the event log always apply.

## Users and sharing

People sign in to the web app with Google. Each plan has one owner, its
creator, and as many contributors as the owner shares it with. Others do not
see it at all.

```sh
rb user me                                          # who you are, your plans
rb plan share   --plan growth --email ana@corp.com  # owner only
rb plan unshare --plan growth --email ana@corp.com  # owner, or a contributor leaving
rb plan members --plan growth
rb key create --name laptop                         # the secret is shown once
rb key list
rb key revoke --name laptop
```

Settings go in `.env` at the repo root (see `.env.example`):

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: the Google OAuth client. Its
  redirect URI is `<PUBLIC_URL>/auth/google/callback`.
- `PUBLIC_URL`: where the web app is served, default `http://127.0.0.1:5190`.
- `DEV=true`: no Google; the web app is signed in as `local@dev`, who owns
  the seed plans. API keys still work.

## Run it locally

Needs Node 22+, pnpm and Docker.

```sh
pnpm install
cp .env.example .env  # DEV=true: signed in as local@dev, no Google needed
pnpm db:up          # Postgres on 127.0.0.1:55440
pnpm db:migrate
pnpm seed           # two fake plans owned by local@dev: demo (a chain) and growth (a tree)
pnpm dev            # API on 127.0.0.1:7979, web app on http://127.0.0.1:5190
```

Then create a key in the web app (Account), or with `curl` while `DEV=true`:

```sh
curl -s -H 'content-type: application/json' -d '{"name":"laptop"}' http://127.0.0.1:7979/api/key.create
export RB_KEY=rb_...
bin/rb plan show --plan growth
```

## A few commands

```sh
rb plan create --title 'More orders' --target '1120 orders a week' --metric orders --unit orders \
  --present-value 1000 --target-value 1120
rb node create --title 'Target'                    # the first node is the target
rb node create --title 'Second line' --enables N1  # one step before N1, provides one of its requirements
rb requirement update --node N1 --requirement second-line --provided-by N3
rb node unlock --ref N1                            # what to tackle now to reach N1, and the size left
rb plan check                                      # gaps, criteria, resources
rb message add --node N2 --text 'Who owns this?'
```

Nothing is addressed by its position: criteria, requirements and resources by
a slug unique in their node (`--criterion`, `--requirement`, `--resource`),
messages by their id (`--message m-7f3a2c`). `rb node show` lists them.

## Event log

Every operation that changes data, from `rb`, the API or the web app, is
written to an append-only log, whether it succeeded or not: who, when, through
what, the input, the outcome. The database refuses any update, deletion or
truncation of the log.

```sh
rb event list --plan growth --last 20          # who did what, and when
rb event replay --plan growth --as growth-then --up-to 250   # the plan as it was at event 250
```

A replay builds a new plan from the successful events of the original,
including a plan that has since been deleted.

## Layout

- `engine/`: Prisma schema, operations (`src/ops`), CLI (`src/cli.ts`), API (`src/server.ts`), seed, isometry check
- `web/`: Vite + React web app
- `scripts/build-cli.mjs`: bundles `rb` into `dist/rb.mjs`, committed so the npm install needs no build
