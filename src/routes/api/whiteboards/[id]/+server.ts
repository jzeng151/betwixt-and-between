import { json, error } from '@sveltejs/kit';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { whiteboards, entities, worldMaps } from '$lib/server/db/schema.js';
import { getStoryId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { isUuid } from '$lib/server/validation.js';
import { documentError, type BoardDocument } from '$lib/features/whiteboard/model.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async event => {
  const storyId = await getStoryId(event);
  if (!isUuid(event.params.id)) error(400, 'Invalid board ID.');
  const [board] = await event.locals.db.select().from(whiteboards).where(and(eq(whiteboards.id, event.params.id), eq(whiteboards.storyId, storyId)));
  if (!board) error(404, 'Board not found.');
  return json(board);
};
export const PUT: RequestHandler = async event => {
  const storyId = await getStoryId(event);
  if (!isUuid(event.params.id)) error(400, 'Invalid board ID.');
  const body = await readJson(event);
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 0) error(400, 'Invalid board revision.');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) error(400, 'Use a name between 1 and 100 characters.');
  const invalid = documentError(body.document);
  if (invalid) error(400, invalid);
  const document = body.document as BoardDocument;
  const [existing] = await event.locals.db.select().from(whiteboards).where(and(eq(whiteboards.id, event.params.id), eq(whiteboards.storyId, storyId)));
  if (!existing) error(404, 'Board not found.');
  // Existing references may outlive their targets; validate only newly added targets.
  const oldTargets = new Set(existing.document.elements.filter(e => e.target).map(e => `${e.target!.kind}:${e.target!.id}`));
  const targets = document.elements.flatMap(e => e.target && !oldTargets.has(`${e.target.kind}:${e.target.id}`) ? [e.target] : []);
  for (const table of [entities, worldMaps]) {
    const ids = [...new Set(targets.filter(t => (t.kind === 'map') === (table === worldMaps)).map(t => t.id))];
    if (!ids.length) continue;
    const owned = await event.locals.db.select({ id: table.id }).from(table).where(and(inArray(table.id, ids), eq(table.storyId, storyId)));
    if (owned.length !== ids.length) error(400, 'References must belong to this story.');
  }
  const [saved] = await event.locals.db.update(whiteboards).set({ name: body.name.trim(), document, revision: sql`${whiteboards.revision} + 1` })
    .where(and(eq(whiteboards.id, existing.id), eq(whiteboards.storyId, storyId), eq(whiteboards.revision, body.revision as number))).returning();
  if (!saved) error(409, 'This board changed in another tab. Download your draft before reloading.');
  return json(saved);
};
export const DELETE: RequestHandler = async event => {
  const storyId = await getStoryId(event);
  if (!isUuid(event.params.id)) error(400, 'Invalid board ID.');
  const [deleted] = await event.locals.db.delete(whiteboards).where(and(eq(whiteboards.id, event.params.id), eq(whiteboards.storyId, storyId))).returning();
  if (!deleted) error(404, 'Board not found.');
  return json({ ok: true });
};
