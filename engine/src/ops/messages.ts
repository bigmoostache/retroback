/** Messages under a node: notes, questions, decisions, from people or agents. Addressed by id (m-xxxxxx). */
import { z } from "zod"
import { db } from "../db.ts"
import { messageHandle } from "../slug.ts"
import { loadNode, nodeOf } from "../views.ts"
import { defineOp, OpError, planFlag } from "./define.ts"

const nodeFlag = z.string().describe("Node ref, e.g. N3.")
const messageFlag = z.string().min(1).describe("Id of the message, e.g. m-7f3a2c, as shown by rb message list.")

const rowsOf = (nodeId: string) => db.message.findMany({ where: { nodeId }, orderBy: { position: "asc" } })

async function messageWith(plan: string | undefined, node: string, id: string) {
  const found = await nodeOf(plan, node)
  const row = await db.message.findUnique({
    where: { nodeId_handle: { nodeId: found.node.id, handle: id.trim().toLowerCase() } },
  })
  if (!row) throw new OpError(`${found.node.ref} has no message "${id}". List them with: rb message list --node ${found.node.ref}`, "not_found")
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
    summary: "Post a message under a node: a note, a question, a decision. Its id is given in the answer.",
    mutates: true,
    input: z.strictObject({
      plan: planFlag,
      node: nodeFlag,
      text: z.string().trim().min(1).describe("The message."),
      author: z.string().trim().min(1).default("anonymous").describe("Who writes it: a name or an agent."),
      id: z
        .string()
        .regex(/^m-[a-z0-9-]{1,40}$/, "an id is m- followed by lowercase letters, digits or dashes")
        .optional()
        .describe("Id of the message, e.g. m-decision. A random one (m-7f3a2c) when omitted."),
    }),
    run: async ({ plan, node, text, author, id }) => {
      const found = await nodeOf(plan, node)
      const rows = await rowsOf(found.node.id)
      const taken = new Set(rows.map((r) => r.handle))
      if (id !== undefined && taken.has(id)) throw new OpError(`${found.node.ref} already has a message "${id}".`, "conflict")
      let handle = id ?? messageHandle()
      while (taken.has(handle)) handle = messageHandle()
      const position = Math.max(0, ...rows.map((r) => r.position)) + 1
      await db.message.create({ data: { nodeId: found.node.id, handle, position, author, text } })
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
      message: messageFlag,
      text: z.string().trim().min(1).optional().describe("The message."),
      author: z.string().trim().min(1).optional().describe("Who wrote it."),
    }),
    run: async ({ plan, node, message, ...data }) => {
      const found = await messageWith(plan, node, message)
      const edited = data.text !== undefined && data.text !== found.row.text
      await db.message.update({ where: { id: found.row.id }, data: { ...data, ...(edited ? { editedAt: new Date() } : {}) } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),

  defineOp({
    name: "message.remove",
    summary: "Remove a message from a node.",
    mutates: true,
    input: z.strictObject({ plan: planFlag, node: nodeFlag, message: messageFlag }),
    run: async ({ plan, node, message }) => {
      const found = await messageWith(plan, node, message)
      await db.message.delete({ where: { id: found.row.id } })
      return loadNode(found.plan.slug, found.node.ref)
    },
  }),
]
