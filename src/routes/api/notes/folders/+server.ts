import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const db = await getDb(platform?.env);
	const rows = await db
		.select()
		.from(entities)
		.where(
			and(eq(entities.type, 'Note'), sql`(${entities.data}->>'isFolder')::boolean = true`)
		)
		.orderBy(entities.position);
	return json(rows);
};

export const POST: RequestHandler = async ({ platform, request }) => {
	const db = await getDb(platform?.env);
	const body = await request.json();
	const { name, parentId, position } = body as {
		name?: string;
		parentId?: string | null;
		position?: number | null;
	};

	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	const [created] = await db
		.insert(entities)
		.values({
			type: 'Note',
			name: name.trim(),
			data: { isFolder: true },
			parentId: parentId ?? null,
			position: position ?? null
		})
		.returning();

	return json(created, { status: 201 });
};
