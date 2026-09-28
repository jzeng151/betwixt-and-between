import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { whiteboards } from '$lib/server/db/schema.js';
import { getStoryId } from '$lib/server/auth-gate.js';
import { isUuid } from '$lib/server/validation.js';
import { uploadImage } from '$lib/server/image-upload.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async event => {
  const storyId = await getStoryId(event);
  if (!isUuid(event.params.id)) error(400, 'Invalid board ID.');
  const [board] = await event.locals.db.select({ id: whiteboards.id }).from(whiteboards).where(and(eq(whiteboards.id, event.params.id), eq(whiteboards.storyId, storyId)));
  if (!board) error(404, 'Board not found.');
  return json(await uploadImage(event.request, event.platform, crypto.randomUUID()));
};
