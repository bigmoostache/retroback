# Retroback

Plan backward from a target to the present.

A plan fixes one metric, its value today and the value aimed at. You create the
target first, then go backward: each new node is what a later node requires.
Each step stays within a small gap (1% by default): small steps, each one
reachable from the one before.

Every node has a title, a description, precise success criteria, requirements
(each one provided by earlier nodes, or ticked by hand), resources of any kind,
a size from 0 to 100, and messages. Requirements make the graph, which
always stays free of loops.

The same operations drive the CLI (`rb`), the HTTP API and the web app, so
anything one can do, the others can too. `pnpm check:isometry` checks it.

## Install the CLI

```sh
npm install -g github:bigmoostache/retroback
rb help
```

`rb` works on a database (`DATABASE_URL`) or on a running engine API:

```sh
rb --api http://host:7979 plan list      # or: RB_API=http://host:7979 rb plan list
```

The `--api` flag wins over `RB_API`. Add `--json` to any command for the raw answer.

## Run it locally

Needs Node 22+, pnpm and Docker.

```sh
pnpm install
pnpm db:up          # Postgres on 127.0.0.1:55440
pnpm db:migrate
pnpm seed           # two fake plans: demo (a chain) and growth (a tree)
pnpm dev            # API on 127.0.0.1:7979, web app on http://127.0.0.1:5190
bin/rb plan show --plan growth
```

## A few commands

```sh
rb plan create --title 'More orders' --target '1120 orders a week' --metric orders --unit orders \
  --present-value 1000 --target-value 1120
rb node create --title 'Target'                    # the first node is the target
rb node create --title 'Second line' --enables N1  # one step before N1, provides one of its requirements
rb requirement link --node N1 --index 1 --by N2
rb node unlock --ref N1                            # what to tackle now to reach N1
rb plan check                                      # gaps, criteria, requirements, resources
rb message add --node N2 --text 'Who owns this?'
```

## Layout

- `engine/`: Prisma schema, operations (`src/ops`), CLI (`src/cli.ts`), API (`src/server.ts`), seed, isometry check
- `web/`: Vite + React web app
- `scripts/build-cli.mjs`: bundles `rb` into `dist/rb.mjs`, committed so the npm install needs no build
