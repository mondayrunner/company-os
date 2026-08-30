// Reversible writes, with a trace.
//
// The rule from CLAUDE.md, in code: making is free as long as it lands
// somewhere you can undo it; the irreversible step stays with a human. A todo
// is a card you can archive, a draft is a file in Drafts, a moved card can be
// moved back. So these run without asking — and every one of them writes a
// row to the events table, which is what the activity log and the dashboard
// read. Nothing in this file sends, pays or publishes; there is no function
// for that on purpose.
import { doAct } from "./connectors.mjs";
import { record } from "./running.mjs";

async function traced(ctx, job, message, fn) {
  try {
    const r = await fn();
    record(ctx, { job, result: "ok", done: 1, failed: 0, message });
    return { ok: true, ...r };
  } catch (e) {
    record(ctx, { job, result: "error", done: 0, failed: 1, message: `${message}: ${e.message}` });
    return { ok: false, error: e.message };
  }
}

/** A new card on the task board; list defaults to the connector's todo list. */
export async function todo(ctx, { title, body = "", due = null, list = null } = {}) {
  if (!title) throw new Error("todo needs a title");
  return traced(ctx, "todo", title.slice(0, 120), async () => {
    const { connector, result } = await doAct(ctx, "tasks", "create", { title, body, due, list });
    return { card: result, source: connector };
  });
}

/** A card to the done list (or another list): the card is closed, not deleted. */
export async function taskDone(ctx, { id, list = null } = {}) {
  if (!id) throw new Error("taskDone needs a card id");
  return traced(ctx, "task done", id, async () => {
    const { connector, result } = await doAct(ctx, "tasks", "move", { id, list });
    return { card: result, source: connector };
  });
}

/** A draft in the mail client's Drafts folder. The body is the agent's; this only files it. */
export async function mailDraft(ctx, { to, subject, body } = {}) {
  if (!to || !subject || !body) throw new Error("mailDraft needs to, subject and body");
  return traced(ctx, "mail draft", `to ${to} · ${subject}`.slice(0, 200), async () => {
    const { connector, result } = await doAct(ctx, "mail", "draft", { to, subject, body });
    return { draft: result, source: connector };
  });
}
