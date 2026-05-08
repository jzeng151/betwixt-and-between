import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, sql, or } from 'drizzle-orm';
import { getUserId, assertParentOwned } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const folderId = event.url.searchParams.get('folderId');

	const conditions = [
		eq(entities.userId, userId),
		eq(entities.type, 'Note'),
		or(
			sql`(${entities.data}->>'isFolder')::boolean IS NOT TRUE`,
			sql`${entities.data}->>'isFolder' IS NULL`
		)!
	];

	if (folderId) {
		conditions.push(eq(entities.parentId, folderId));
	}

	const rows = await db
		.select()
		.from(entities)
		.where(and(...conditions))
		.orderBy(entities.position);

	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { name, body: noteBody, parentId, position } = body as {
		name?: string;
		body?: string;
		parentId?: string | null;
		position?: number | null;
	};

	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	await assertParentOwned(db, userId, parentId ?? null);

	const [created] = await db
		.insert(entities)
		.values({
			userId,
			type: 'Note',
			name: name.trim(),
			data: { body: noteBody ?? '' },
			parentId: parentId ?? null,
			position: position ?? null
		})
		.returning();

	return json(created, { status: 201 });
};
