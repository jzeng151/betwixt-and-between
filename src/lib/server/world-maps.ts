/**
 * Server-side helpers for the `world_maps` table.
 *
 * Currently houses the polymorphic-FK guard for `location_id` (must point at
 * an entity of type='Location'). Same pattern as intervals.ts's act/scene FK
 * validation: Postgres can't CHECK a column's referent type cleanly, so the
 * invariant is upheld at the write layer plus a Vitest invariant test.
 *
 * v2 will grow this module with `recomputeWorldMapVariantsAll` (M11) when the
 * scene-range columns and variant resolution land in Step 3.
 */
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { entities } from './db/schema.js';
import { isUuid } from './validation.js';

type DB = {
	select: (...args: unknown[]) => {
		from: (...args: unknown[]) => {
			where: (...args: unknown[]) => Promise<Array<{ type: string }>>;
		};
	};
};

/**
 * Assert that `locationId`, if provided, references an entity with
 * type='Location' owned by `userId`. Throws SvelteKit error(400) on failure.
 *
 * Pass-through for null/undefined: a map can be unlinked from any Location.
 */
export async function assertLocationIdIsLocation(
	db: unknown,
	userId: string,
	locationId: string | null | undefined
): Promise<void> {
	if (locationId === null || locationId === undefined) return;
	if (!isUuid(locationId)) error(400, 'location_id must be a UUID');

	const rows = await (db as DB)
		.select({ type: entities.type })
		.from(entities)
		.where(and(eq(entities.id, locationId), eq(entities.userId, userId)));

	if (rows.length === 0) error(400, 'location_id does not reference an existing entity');
	if (rows[0].type !== 'Location') {
		error(400, `location_id must reference a Location entity (got type='${rows[0].type}')`);
	}
}
