import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, or, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const [row] = await db
		.select()
		.from(entities)
		.where(
			and(
				eq(entities.id, params.id),
				eq(entities.type, 'Note'),
				or(
					sql`(${entities.data}->>'isFolder')::boolean IS NOT TRUE`,
					sql`${entities.data}->>'isFolder' IS NULL`
				)!
			)
		);
	if (!row) error(404, 'Entry not found');
	return json(row);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { name, body: noteBody, folderId } = body as {
		name?: string;
		body?: string;
		folderId?: string | null;
	};

	// Verify it's an entry (not a folder)
	const [existing] = await db
		.select()
		.from(entities)
		.where(
			and(
				eq(entities.id, params.id),
				eq(entities.type, 'Note'),
				or(
					sql`(${entities.data}->>'isFolder')::boolean IS NOT TRUE`,
					sql`${entities.data}->>'isFolder' IS NULL`
				)!
			)
		);
	if (!existing) error(404, 'Entry not found');

	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name.trim();
	if (noteBody !== undefined) {
		const data = (existing.data as Record<string, unknown>) ?? {};
		updates.data = { ...data, body: noteBody };
	}
	if (folderId !== undefined) updates.parentId = folderId;

	if (Object.keys(updates).length === 0) return json(existing);

	const [updated] = await db
		.update(entities)
		.set(updates)
		.where(eq(entities.id, params.id))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const [existing] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(
			and(
				eq(entities.id, params.id),
				eq(entities.type, 'Note'),
				or(
					sql`(${entities.data}->>'isFolder')::boolean IS NOT TRUE`,
					sql`${entities.data}->>'isFolder' IS NULL`
				)!
			)
		);
	if (!existing) error(404, 'Entry not found');

	await db.delete(entities).where(eq(entities.id, params.id));
	return json({ ok: true });
};
