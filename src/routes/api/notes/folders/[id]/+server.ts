import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

const isFolderFilter = (id: string, userId: string) =>
	and(
		eq(entities.id, id),
		eq(entities.userId, userId),
		eq(entities.type, 'Note'),
		sql`(${entities.data}->>'isFolder')::boolean = true`
	);

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { name } = body as { name?: string };

	const [existing] = await db
		.select()
		.from(entities)
		.where(isFolderFilter(event.params.id, userId));
	if (!existing) error(404, 'Folder not found');

	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name.trim();

	if (Object.keys(updates).length === 0) return json(existing);

	const [updated] = await db
		.update(entities)
		.set(updates)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [existing] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(isFolderFilter(event.params.id, userId));
	if (!existing) error(404, 'Folder not found');

	await db
		.delete(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	return json({ ok: true });
};
