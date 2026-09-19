import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { stories } from '$lib/server/db/schema.js';
import { isUuid } from '$lib/server/validation.js';
import { readJson } from '$lib/server/read-json.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const userId = getUserId(event);
	if (!isUuid(event.params.id)) error(400, 'Invalid story id');
	const body = await readJson(event);
	if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) error(400, 'Use a story name between 1 and 100 characters.');
	const [story] = await event.locals.db.update(stories).set({ name: body.name.trim() })
		.where(and(eq(stories.id, event.params.id), eq(stories.userId, userId))).returning();
	if (!story) error(404, 'Story not found');
	return json(story);
};
