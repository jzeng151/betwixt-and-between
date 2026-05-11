import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { getUserId, assertParentOwned } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(entities)
		.where(
			and(
				eq(entities.userId, userId),
				eq(entities.type, 'Note'),
				sql`(${entities.data}->>'isFolder')::boolean = true`
			)
		)
		.orderBy(entities.position);
	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { name, parentId, position } = body as {
		name?: string;
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
			data: { isFolder: true },
			parentId: parentId ?? null,
			position: position ?? null
		})
		.returning();

	return json(created, { status: 201 });
};
