import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { relationships } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	const [rel] = await db.select().from(relationships).where(eq(relationships.id, params.id));
	if (!rel) error(404, 'Relationship not found');

	await db.delete(relationships).where(eq(relationships.id, params.id));
	return new Response(null, { status: 204 });
};
