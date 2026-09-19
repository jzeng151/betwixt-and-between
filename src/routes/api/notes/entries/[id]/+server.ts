import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, or, sql } from 'drizzle-orm';
import { getStoryId, assertParentOwned } from '$lib/server/auth-gate.js';
import { validateNoteDataSize } from '$lib/server/style-validation.js';
import type { RequestHandler } from './$types';

const isEntryFilter = (id: string, storyId: string) =>
	and(
		eq(entities.id, id),
		eq(entities.storyId, storyId),
		eq(entities.type, 'Note'),
		or(
			sql`(${entities.data}->>'isFolder')::boolean IS NOT TRUE`,
			sql`${entities.data}->>'isFolder' IS NULL`
		)!
	);

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	const [row] = await db.select().from(entities).where(isEntryFilter(event.params.id, storyId));
	if (!row) error(404, 'Entry not found');
	return json(row);
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	const body = await event.request.json();
	const { name, body: noteBody, folderId } = body as {
		name?: string;
		body?: string;
		folderId?: string | null;
	};

	const [existing] = await db.select().from(entities).where(isEntryFilter(event.params.id, storyId));
	if (!existing) error(404, 'Entry not found');

	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name.trim();
	if (noteBody !== undefined) {
		const data = (existing.data as Record<string, unknown>) ?? {};
		const merged = { ...data, body: noteBody };
		validateNoteDataSize(merged, 'note.body');
		updates.data = merged;
	}
	if (folderId !== undefined) {
		await assertParentOwned(db, storyId, folderId);
		updates.parentId = folderId;
	}

	if (Object.keys(updates).length === 0) return json(existing);

	const [updated] = await db
		.update(entities)
		.set(updates)
		.where(and(eq(entities.id, event.params.id), eq(entities.storyId, storyId)))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	const [existing] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(isEntryFilter(event.params.id, storyId));
	if (!existing) error(404, 'Entry not found');

	await db
		.delete(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.storyId, storyId)));
	return json({ ok: true });
};
