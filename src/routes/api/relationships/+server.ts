import { json, error } from '@sveltejs/kit';
import { relationships, entities } from '$lib/server/db/schema.js';
import { RelationshipType } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { isPgError } from '$lib/server/pg-errors.js';
import { resolveRelationshipBounds } from '$lib/server/intervals.js';
import { assertPartOfInvariants } from '$lib/server/location-hierarchy.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(relationships)
		.where(eq(relationships.userId, userId));
	const fromId = event.url.searchParams.get('fromId');
	const toId = event.url.searchParams.get('toId');
	const filtered = rows.filter(
		(r) => (!fromId || r.fromId === fromId) && (!toId || r.toId === toId)
	);
	return json(filtered);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// readJson → a non-object body is a clean 400, not a destructure 500 (2026-06
	// review — parity with the entity/interval/region routes' body parsing).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const { fromId, toId, type, label, startActId, startSceneId, endActId, endSceneId, revealedAtPosition } = body;

	if (!RelationshipType.includes(type)) {
		error(400, 'Invalid relationship type');
	}
	if (!fromId || !toId) {
		error(400, 'fromId and toId are required');
	}

	// Both endpoints must belong to the user (cross-user FK = leak).
	const [from] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, fromId), eq(entities.userId, userId)));
	if (!from) error(400, 'fromId entity not found');

	const [to] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, toId), eq(entities.userId, userId)));
	if (!to) error(400, 'toId entity not found');

	if (type === 'part_of') {
		await assertPartOfInvariants(db, userId, fromId, toId);
	}

	// Scenes are children of acts — a scene FK without its parent act FK is
	// auto-cleared, mirroring the PATCH merge rule and the maps POST. Without
	// this, resolveRelationshipBounds short-circuits on null act FKs and the
	// INSERT below would persist a scene FK that was never ownership/type
	// validated (a cross-tenant UUID could be written verbatim).
	const normalizedStartActId = startActId ?? null;
	const normalizedEndActId = endActId ?? null;
	const normalizedStartSceneId = normalizedStartActId === null ? null : (startSceneId ?? null);
	const normalizedEndSceneId = normalizedEndActId === null ? null : (endSceneId ?? null);

	let startPosition: number | null = null;
	let endPosition: number | null = null;
	try {
		const bounds = await resolveRelationshipBounds(
			db,
			{
				startActId: normalizedStartActId,
				startSceneId: normalizedStartSceneId,
				endActId: normalizedEndActId,
				endSceneId: normalizedEndSceneId
			},
			userId
		);
		startPosition = bounds.startPosition;
		endPosition = bounds.endPosition;
	} catch (err) {
		// resolveRelationshipBounds throws plain Errors with safe messages (Scene
		// not found, scene-parent/act mismatch) → 400. A driver error (malformed-
		// UUID cast etc.) is opaqued as a 500 so its raw message can't leak.
		if ((err as { status?: number }).status) throw err;
		if (isPgError(err)) throw err;
		error(400, (err as Error).message);
	}

	let created;
	try {
		[created] = await db
			.insert(relationships)
			.values({
				userId,
				fromId,
				toId,
				type,
				label: label ?? null,
				startActId: normalizedStartActId,
				startSceneId: normalizedStartSceneId,
				endActId: normalizedEndActId,
				endSceneId: normalizedEndSceneId,
				startPosition,
				endPosition,
				revealedAtPosition: revealedAtPosition ?? null
			})
			.returning();
	} catch (err) {
		const code = (err as { code?: string }).code ?? '';
		const causeCode = (err as { cause?: { code?: string } }).cause?.code ?? '';
		const msg = `${(err as Error).message ?? ''} ${(err as { cause?: { message?: string } }).cause?.message ?? ''}`;
		if (
			code === '23505' ||
			causeCode === '23505' ||
			msg.includes('relationships_one_part_of_parent')
		) {
			if (type === 'part_of' || msg.includes('relationships_one_part_of_parent')) {
				error(409, 'This location already has a parent — remove the existing part_of edge first');
			}
			error(409, 'A relationship with these temporal bounds already exists');
		}
		throw err;
	}

	return json(created, { status: 201 });
};
