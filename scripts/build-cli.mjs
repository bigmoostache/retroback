// Builds the `rb` command into dist/rb.mjs: one file, run by plain node.
// Runs on `npm install <repo>` (the "prepare" script), so it may only use the
// root package's own dependencies.
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"

const root = path.resolve(import.meta.dirname, "..")
const engine = path.join(root, "engine")
const bin = (name) => path.join(root, "node_modules", ".bin", name)

// The database client is generated from the schema; no database is needed for that.
if (!existsSync(path.join(engine, "src/generated/prisma/client.ts"))) {
  execFileSync(bin("prisma"), ["generate"], { cwd: engine, stdio: "inherit" })
}

const out = path.join(root, "dist/rb.mjs")
await build({
  entryPoints: [path.join(engine, "src/cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Installed next to rb (see package.json); the Prisma runtime loads files of its own.
  external: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
})
chmodSync(out, 0o755)
console.log(`Built ${path.relative(root, out)}`)
