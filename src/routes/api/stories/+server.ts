import { json, error } from '@sveltejs/kit';
import { eq, asc } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { stories, user } from '$lib/server/db/schema.js';
import { readJson } from '$lib/server/read-json.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const userId = getUserId(event);
	return json(await event.locals.db.select().from(stories).where(eq(stories.userId, userId)).orderBy(asc(stories.createdAt)));
};

export const POST: RequestHandler = async (event) => {
	const userId = getUserId(event);
	const body = await readJson(event);
	if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) error(400, 'Use a story name between 1 and 100 characters.');
	const name = body.name.trim();
	const story = await event.locals.db.transaction(async tx => {
		await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
		const existing = await tx.select({ id: stories.id }).from(stories).where(eq(stories.userId, userId));
		if (existing.length >= 100) error(409, 'This account has reached the limit of 100 stories.');
		const [created] = await tx.insert(stories).values({ userId, name }).returning();
		return created;
	});
	return json(story, { status: 201 });
};
