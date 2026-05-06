import { json, error } from '@sveltejs/kit';
import { withDb } from '$lib/server/db/index.js';
import { relationships } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveRelationshipBounds } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ platform, params, request }) =>
	withDb(platform?.env, async (db) => {
	const [rel] = await db.select().from(relationships).where(eq(relationships.id, params.id));
	if (!rel) error(404, 'Relationship not found');

	const body = await request.json();
	const {
		type,
		label,
		startActId,
		startSceneId,
		endActId,
		endSceneId,
		revealedAtPosition
	} = body;

	// Merge incoming temporal FKs with existing ones (undefined means keep existing).
	// Scenes are children of acts — clearing an act FK must also clear its scene FK.
	const mergedStartActId = startActId !== undefined ? (startActId ?? null) : rel.startActId;
	const mergedStartSceneId = mergedStartActId === null
		? null
		: (startSceneId !== undefined ? (startSceneId ?? null) : rel.startSceneId);
	const mergedEndActId = endActId !== undefined ? (endActId ?? null) : rel.endActId;
	const mergedEndSceneId = mergedEndActId === null
		? null
		: (endSceneId !== undefined ? (endSceneId ?? null) : rel.endSceneId);

	let startPosition: number | null = rel.startPosition;
	let endPosition: number | null = rel.endPosition;

	// Re-resolve positions if any temporal FK changed
	const temporalChanged =
		startActId !== undefined ||
		startSceneId !== undefined ||
		endActId !== undefined ||
		endSceneId !== undefined;

	if (temporalChanged) {
		try {
			const bounds = await resolveRelationshipBounds(db, {
				startActId: mergedStartActId,
				startSceneId: mergedStartSceneId,
				endActId: mergedEndActId,
				endSceneId: mergedEndSceneId
			});
			startPosition = bounds.startPosition;
			endPosition = bounds.endPosition;
		} catch (err) {
			error(400, (err as Error).message);
		}
	}

	const patch: Partial<typeof rel> = {
		startActId: mergedStartActId,
		startSceneId: mergedStartSceneId,
		endActId: mergedEndActId,
		endSceneId: mergedEndSceneId,
		startPosition,
		endPosition
	};
	if (type !== undefined) patch.type = type;
	if (label !== undefined) patch.label = label ?? null;
	if (revealedAtPosition !== undefined) patch.revealedAtPosition = revealedAtPosition ?? null;

	let updated;
	try {
		[updated] = await db
			.update(relationships)
			.set(patch)
			.where(eq(relationships.id, params.id))
			.returning();
	} catch (err) {
		const code = (err as { code?: string }).code ?? '';
		const msg = (err as Error).message ?? '';
		if (code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
			error(409, 'A relationship with these temporal bounds already exists');
		}
		throw err;
	}

	return json(updated);

	});

export const DELETE: RequestHandler = async ({ platform, params }) =>
	withDb(platform?.env, async (db) => {
	const [rel] = await db.select().from(relationships).where(eq(relationships.id, params.id));
	if (!rel) error(404, 'Relationship not found');

	await db.delete(relationships).where(eq(relationships.id, params.id));
	return new Response(null, { status: 204 });

	});
