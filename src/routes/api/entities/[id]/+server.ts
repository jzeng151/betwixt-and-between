import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entities } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const [entity] = await db.select().from(entities).where(eq(entities.id, params.id));
	if (!entity) error(404, 'Entity not found');
	return json(entity);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json();
	const { name, data } = body;

	const [entity] = await db.select().from(entities).where(eq(entities.id, params.id));
	if (!entity) error(404, 'Entity not found');

	const updates: Record<string, unknown> = {
		updatedAt: sql`(unixepoch())`
	};
	if (name !== undefined) updates.name = name.trim();
	if (data !== undefined) updates.data = JSON.stringify(data);

	const [updated] = await db
		.update(entities)
		.set(updates)
		.where(eq(entities.id, params.id))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const [entity] = await db.select().from(entities).where(eq(entities.id, params.id));
	if (!entity) error(404, 'Entity not found');

	await db.delete(entities).where(eq(entities.id, params.id));
	return new Response(null, { status: 204 });
};
