import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { entityAliases, entities } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const primaryEntityId = url.searchParams.get('primaryEntityId');

	const rows = primaryEntityId
		? await db.select().from(entityAliases).where(eq(entityAliases.primaryEntityId, primaryEntityId))
		: await db.select().from(entityAliases);

	return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { primaryEntityId, aliasEntityId, revealedAtPosition } = body;

	if (!primaryEntityId || !aliasEntityId) {
		error(400, 'primaryEntityId and aliasEntityId are required');
	}
	if (primaryEntityId === aliasEntityId) {
		error(400, 'primaryEntityId and aliasEntityId must be different entities');
	}

	const [primary] = await db.select().from(entities).where(eq(entities.id, primaryEntityId));
	if (!primary) error(400, 'primaryEntityId entity not found');

	const [alias] = await db.select().from(entities).where(eq(entities.id, aliasEntityId));
	if (!alias) error(400, 'aliasEntityId entity not found');

	if (primary.type !== alias.type) {
		error(422, `Cannot alias entities of different types: ${primary.type} vs ${alias.type}`);
	}

	// Check for duplicate before insert to return 409 vs a generic DB error
	const [dup] = await db
		.select()
		.from(entityAliases)
		.where(
			eq(entityAliases.primaryEntityId, primaryEntityId)
		)
		.then((rows) => rows.filter((r) => r.aliasEntityId === aliasEntityId));

	if (dup) {
		error(409, 'Alias already exists for this primary entity pair');
	}

	const [created] = await db
		.insert(entityAliases)
		.values({
			primaryEntityId,
			aliasEntityId,
			revealedAtPosition: revealedAtPosition ?? null
		})
		.returning();

	return json(created, { status: 201 });
};
