import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { relationships } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveRelationshipBounds } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
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

	// Merge incoming temporal FKs with existing ones (undefined means keep existing)
	const mergedStartActId = startActId !== undefined ? (startActId ?? null) : rel.startActId;
	const mergedStartSceneId = startSceneId !== undefined ? (startSceneId ?? null) : rel.startSceneId;
	const mergedEndActId = endActId !== undefined ? (endActId ?? null) : rel.endActId;
	const mergedEndSceneId = endSceneId !== undefined ? (endSceneId ?? null) : rel.endSceneId;

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

	const [updated] = await db
		.update(relationships)
		.set(patch)
		.where(eq(relationships.id, params.id))
		.returning();

	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const [rel] = await db.select().from(relationships).where(eq(relationships.id, params.id));
	if (!rel) error(404, 'Relationship not found');

	await db.delete(relationships).where(eq(relationships.id, params.id));
	return new Response(null, { status: 204 });
};
