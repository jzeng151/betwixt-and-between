import { json, error } from '@sveltejs/kit';
import { eq, asc } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { stories, user } from '$lib/server/db/schema.js';
import { readJson } from '$lib/server/read-json.js';
import { isUuid } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const userId = getUserId(event);
	return json(await event.locals.db.select().from(stories).where(eq(stories.userId, userId)).orderBy(asc(stories.createdAt)));
};

// POST { name, id?: UUID } replays an owned creation with the same ID and name.
// Invalid input returns 400; ID conflicts or the 100-story limit return 409.
export const POST: RequestHandler = async (event) => {
	const userId = getUserId(event);
	const body = await readJson(event);
	if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) error(400, 'Use a story name between 1 and 100 characters.');
	const name = body.name.trim();
	if (body.id !== undefined && !isUuid(body.id)) error(400, 'Invalid story id');
	const id = typeof body.id === 'string' ? body.id.toLowerCase() : undefined;
	const story = await event.locals.db.transaction(async tx => {
		await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
		const existing = await tx.select().from(stories).where(eq(stories.userId, userId));
		const replay = id && existing.find(story => story.id === id);
		if (replay) {
			if (replay.name !== name) error(409, 'Story id already exists with a different name.');
			return replay;
		}
		if (existing.length >= 100) error(409, 'This account has reached the limit of 100 stories.');
		const [created] = await tx.insert(stories).values({ id, userId, name })
			.onConflictDoNothing({ target: stories.id }).returning();
		if (!created) error(409, 'Story id is unavailable.');
		return created;
	});
	return json(story, { status: 201 });
};
