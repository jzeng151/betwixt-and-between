/**
 * appears_in hijack regression test (CRITICAL — Issue 1.1 from /plan-eng-review).
 *
 * After the migration removes existing appears_in rows from the relationships
 * table, the V1 UIs (CharacterEditor, StoryGraph edge-creation) keep writing
 * `type='appears_in'` to POST /api/relationships. The hijack must:
 *
 *   1. Detect type='appears_in' on POST.
 *   2. Validate to_id is an Act.
 *   3. Call writeInterval() to create an interval.
 *   4. Return a relationships-shaped row so UIs don't break.
 *
 * Then the V1 timeline (via the compat layer) should see the new presence.
 *
 * This is a unit-level integration test: we exercise the hijack logic at the
 * function level (without spinning up the SvelteKit server) by simulating
 * what the POST handler does. The full HTTP path is exercised by the existing
 * Playwright E2E suite once it's run after migration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals, relationships, RelationshipType } from '../../src/lib/server/db/schema.js';
type RelType = (typeof RelationshipType)[number];
import { writeInterval } from '../../src/lib/server/intervals.js';
import {
	getCharacterAppearancesForActs,
	getAppearsInRelationships
} from '../../src/lib/server/timeline-compat.js';

/**
 * Minimal repro of POST /api/relationships hijack logic, scoped to the
 * appears_in branch only. Mirrors src/routes/api/relationships/+server.ts.
 */
async function postRelationshipHijacked(
	db: ReturnType<typeof createTestDb>,
	body: { fromId: string; toId: string; type: string; label?: string }
): Promise<{ id: string; fromId: string; toId: string; type: string; label: string | null }> {
	const [from] = await db.select().from(entities).where(eq(entities.id, body.fromId));
	if (!from) throw new Error('fromId entity not found');
	const [to] = await db.select().from(entities).where(eq(entities.id, body.toId));
	if (!to) throw new Error('toId entity not found');

	if (body.type === 'appears_in') {
		if (to.type !== 'Act') {
			throw new Error(`appears_in requires toId to be an Act (got '${to.type}')`);
		}
		const interval = await writeInterval(db, {
			entityId: body.fromId,
			startActId: body.toId,
			endActId: body.toId
		});
		return {
			id: `interval:${interval.id}`,
			fromId: body.fromId,
			toId: body.toId,
			label: body.label ?? null,
			type: 'appears_in'
		};
	}

	const [created] = await db
		.insert(relationships)
		.values({
			fromId: body.fromId,
			toId: body.toId,
			type: body.type as RelType,
			label: body.label ?? null
		})
		.returning();
	return created;
}

describe('appears_in hijack — Issue 1.1 regression', () => {
	let db: ReturnType<typeof createTestDb>;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = createTestDb();
		acts = await seedActs(db);
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = a.id;
	});

	it('POST /api/relationships type=appears_in writes to intervals, NOT to relationships', async () => {
		const result = await postRelationshipHijacked(db, {
			fromId: ellie,
			toId: acts.act1,
			type: 'appears_in'
		});

		// No row in relationships.
		const rels = await db.select().from(relationships);
		expect(rels).toHaveLength(0);

		// One row in intervals.
		const ints = await db.select().from(intervals);
		expect(ints).toHaveLength(1);
		expect(ints[0].entityId).toBe(ellie);
		expect(ints[0].startActId).toBe(acts.act1);
		expect(ints[0].endActId).toBe(acts.act1);

		// Returned shape matches relationships row, with synthetic id prefix.
		expect(result.fromId).toBe(ellie);
		expect(result.toId).toBe(acts.act1);
		expect(result.type).toBe('appears_in');
		expect(result.id.startsWith('interval:')).toBe(true);
	});

	it('regression check: V1 timeline (via compat layer) sees the new presence', async () => {
		// Pretend a user opened CharacterEditor and clicked "+" to add Ellie to Act 1.
		// This triggers POST /api/relationships type=appears_in, which is hijacked.
		await postRelationshipHijacked(db, {
			fromId: ellie,
			toId: acts.act1,
			type: 'appears_in'
		});

		// Now the V1 Timeline data loader queries the compat layer.
		const appearances = await getCharacterAppearancesForActs(db);
		expect(appearances).toEqual([{ entityId: ellie, actId: acts.act1 }]);

		// And StoryGraph (also via compat) sees the appears_in edge.
		const edges = await getAppearsInRelationships(db);
		expect(edges).toHaveLength(1);
		expect(edges[0].fromId).toBe(ellie);
		expect(edges[0].toId).toBe(acts.act1);
		expect(edges[0].type).toBe('appears_in');
	});

	it('non-appears_in relationships still write to relationships table directly', async () => {
		const [damien] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();

		const result = await postRelationshipHijacked(db, {
			fromId: ellie,
			toId: damien.id,
			type: 'rivals'
		});

		const rels = await db.select().from(relationships);
		expect(rels).toHaveLength(1);
		expect(rels[0].type).toBe('rivals');

		const ints = await db.select().from(intervals);
		expect(ints).toHaveLength(0);

		// No 'interval:' prefix on this id.
		expect(result.id.startsWith('interval:')).toBe(false);
	});

	it('rejects appears_in pointing at a non-Act entity (preserves data integrity)', async () => {
		const [damien] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();

		await expect(
			postRelationshipHijacked(db, {
				fromId: ellie,
				toId: damien.id,
				type: 'appears_in'
			})
		).rejects.toThrow(/Act/);

		// Nothing wrote anywhere.
		const rels = await db.select().from(relationships);
		const ints = await db.select().from(intervals);
		expect(rels).toHaveLength(0);
		expect(ints).toHaveLength(0);
	});
});
