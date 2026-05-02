import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entityAliases } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	const [alias] = await db.select().from(entityAliases).where(eq(entityAliases.id, params.id));
	if (!alias) error(404, 'Entity alias not found');

	await db.delete(entityAliases).where(eq(entityAliases.id, params.id));
	return new Response(null, { status: 204 });
};
