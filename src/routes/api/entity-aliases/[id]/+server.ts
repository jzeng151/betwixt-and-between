import { error } from '@sveltejs/kit';
import { entityAliases, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);

	// Verify ownership via JOIN on primaryEntityId → entities.userId. Cross-user
	// access returns 404 (no existence leak).
	const [alias] = await db
		.select({ id: entityAliases.id })
		.from(entityAliases)
		.innerJoin(entities, eq(entities.id, entityAliases.primaryEntityId))
		.where(and(eq(entityAliases.id, event.params.id), eq(entities.userId, userId)));
	if (!alias) error(404, 'Entity alias not found');

	await db.delete(entityAliases).where(eq(entityAliases.id, event.params.id));
	return new Response(null, { status: 204 });
};
