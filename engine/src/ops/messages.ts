/** Messages under a node: notes, questions, decisions, from people or agents. */
import { z } from "zod"
import { db } from "../db.ts"
import { loadNode, nodeOf } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const nodeFlag = z.string().describe("Node ref, e.g. N3.")
const indexFlag = z.number().int().min(1).describe("Position of the message under the node, starting at 1.")

const rowsOf = (nodeId: string) => db.message.findMany({ where: { nodeId }, orderBy: { position: "asc" } })

async function messageAt(plan: string | undefined, node: string, index: number) {
  const found = await nodeOf(plan, node)
  const rows = await rowsOf(found.node.id)
  const row = rows[index - 1]
  if (!row) throw new OpError(`${found.node.ref} has no message ${index} (it has ${rows.length}).`, "not_found")
  return { ...found, row }
}

export const messageOps = [
  defineOp({
    name: "message.list",
    summary: "List the messages under a node, oldest first.",
    mutates: false,
    input: z.strictObject({ plan: planFlag, node: nodeFlag }),
    run: async ({ plan, node }) => {
      const found = await nodeOf(plan, node)
      return (await loadNode(found.plan.slug, found.node.ref)).messages
    },
  }),

  defineOp({
    name: "message.add",
    summary: "Post a message under a node: a note, a question, a decision.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      text: z.string().trim().min(1).describe("The message."),
      author: z.string().trim().min(1).default("anonymous").describe("Who writes it: a name or an agent."),
    }),
    run: async ({ plan, node, text, author }) => {
      const found = await nodeOf(plan, node)
      const position = Math.max(0, ...(await rowsOf(found.node.id)).map((r) => r.position)) + 1
      await db.message.create({ data: { nodeId: found.node.id, position, author, text } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),

  defineOp({
    name: "message.update",
    summary: "Change the text or the author of a message.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      index: indexFlag,
      text: z.string().trim().min(1).optional().describe("The message."),
      author: z.string().trim().min(1).optional().describe("Who wrote it."),
    }),
    run: async ({ plan, node, index, ...data }) => {
      const found = await messageAt(plan, node, index)
      const edited = data.text !== undefined && data.text !== found.row.text
      await db.message.update({ where: { id: found.row.id }, data: { ...data, ...(edited ? { editedAt: new Date() } : {}) } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),

  defineOp({
    name: "message.remove",
    summary: "Remove a message from a node.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, index: indexFlag }),
    run: async ({ plan, node, index }) => {
      const found = await messageAt(plan, node, index)
      await db.message.delete({ where: { id: found.row.id } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
]
