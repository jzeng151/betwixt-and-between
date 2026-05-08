import { json, error } from '@sveltejs/kit';
import { entityAliases, entities } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import type { RequestHandler } from './$types';

/**
 * entityAliases has no direct userId column — scoped via JOIN on
 * primaryEntityId → entities.userId. This keeps the schema lean (alias rows
 * inherit ownership from their primary) at the cost of needing JOINs in every
 * query here. T8b S5'.
 */
export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const primaryEntityId = event.url.searchParams.get('primaryEntityId');

	const baseQuery = db
		.select({
			id: entityAliases.id,
			primaryEntityId: entityAliases.primaryEntityId,
			aliasEntityId: entityAliases.aliasEntityId,
			revealedAtPosition: entityAliases.revealedAtPosition,
			createdAt: entityAliases.createdAt
		})
		.from(entityAliases)
		.innerJoin(entities, eq(entities.id, entityAliases.primaryEntityId));

	const rows = primaryEntityId
		? await baseQuery.where(
				and(
					eq(entities.userId, userId),
					eq(entityAliases.primaryEntityId, primaryEntityId)
				)
			)
		: await baseQuery.where(eq(entities.userId, userId));

	return json(rows);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { primaryEntityId, aliasEntityId, revealedAtPosition } = body;

	if (!primaryEntityId || !aliasEntityId) {
		error(400, 'primaryEntityId and aliasEntityId are required');
	}
	if (primaryEntityId === aliasEntityId) {
		error(400, 'primaryEntityId and aliasEntityId must be different entities');
	}

	// Both entities must belong to the user.
	const [primary] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, primaryEntityId), eq(entities.userId, userId)));
	if (!primary) error(400, 'primaryEntityId entity not found');

	const [alias] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, aliasEntityId), eq(entities.userId, userId)));
	if (!alias) error(400, 'aliasEntityId entity not found');

	if (primary.type !== alias.type) {
		error(422, `Cannot alias entities of different types: ${primary.type} vs ${alias.type}`);
	}

	const [dup] = await db
		.select()
		.from(entityAliases)
		.where(
			and(
				eq(entityAliases.primaryEntityId, primaryEntityId),
				eq(entityAliases.aliasEntityId, aliasEntityId)
			)
		);

	if (dup) {
		error(409, 'Alias already exists for this primary entity pair');
	}

	let created;
	try {
		[created] = await db
			.insert(entityAliases)
			.values({
				primaryEntityId,
				aliasEntityId,
				revealedAtPosition: revealedAtPosition ?? null
			})
			.returning();
	} catch (err) {
		const code = (err as { code?: string }).code ?? '';
		const msg = (err as Error).message ?? '';
		if (code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
			error(409, 'Alias already exists for this primary entity pair');
		}
		throw err;
	}

	return json(created, { status: 201 });
};
