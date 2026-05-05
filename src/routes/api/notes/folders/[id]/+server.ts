import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { name } = body as { name?: string };

	// Verify it's a folder
	const [existing] = await db
		.select()
		.from(entities)
		.where(
			and(eq(entities.id, params.id), eq(entities.type, 'Note'), sql`(${entities.data}->>'isFolder')::boolean = true`)
		);
	if (!existing) error(404, 'Folder not found');

	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name.trim();

	if (Object.keys(updates).length === 0) return json(existing);

	const [updated] = await db
		.update(entities)
		.set(updates)
		.where(eq(entities.id, params.id))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	// Verify it's a folder
	const [existing] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(
			and(eq(entities.id, params.id), eq(entities.type, 'Note'), sql`(${entities.data}->>'isFolder')::boolean = true`)
		);
	if (!existing) error(404, 'Folder not found');

	// Cascade on the FK handles child entries
	await db.delete(entities).where(eq(entities.id, params.id));
	return json({ ok: true });
};
