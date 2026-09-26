import { json, error } from '@sveltejs/kit';
import { and, eq, count } from 'drizzle-orm';
import { whiteboards, stories } from '$lib/server/db/schema.js';
import { getStoryId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { isUuid } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async event => {
  const storyId = await getStoryId(event);
  return json(await event.locals.db.select({ id: whiteboards.id, name: whiteboards.name }).from(whiteboards).where(eq(whiteboards.storyId, storyId)).orderBy(whiteboards.createdAt).limit(100));
};
export const POST: RequestHandler = async event => {
  const storyId = await getStoryId(event);
  const body = await readJson(event);
  if (!isUuid(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) error(400, 'Use a valid board ID and a name between 1 and 100 characters.');
  const id = body.id as string, name = body.name.trim();
  const board = await event.locals.db.transaction(async tx => {
    await tx.select().from(stories).where(eq(stories.id, storyId)).for('update');
    const [existing] = await tx.select().from(whiteboards).where(and(eq(whiteboards.id, id), eq(whiteboards.storyId, storyId)));
    if (existing) return existing;
    const [total] = await tx.select({ value: count() }).from(whiteboards).where(eq(whiteboards.storyId, storyId));
    if (total.value >= 100) error(400, 'A story supports up to 100 boards.');
    const [created] = await tx.insert(whiteboards).values({ id, name, storyId }).onConflictDoNothing().returning();
    if (!created) error(409, 'This board ID is already in use.');
    return created;
  });
  return json(board, { status: 201 });
};
