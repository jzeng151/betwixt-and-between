/**
 * WM3 Slice 5 PR-E (D6, ADR 0006) — Causal Cartography provenance walk.
 *
 * Verifies traceRegionProvenance: region changed at T → transfer_region event →
 * source_event_id Event → caused_by ancestry BFS → earliest cause. The CRITICAL
 * paths from the plan's test-coverage diagram:
 *   - seeded linear chain → earliest cause returned, chain ordered, jump position
 *   - caused_by cycle → BFS terminates (visited-set guard)
 *   - cross-user ancestor → walk stops at the ownership boundary
 *   - null source_event_id → "no recorded cause"
 *   - no transfer_region for the region → "no change"
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, relationships, worldMaps, mapEvents } from '../../src/lib/server/db/schema.js';
import { traceRegionProvenance } from '../../src/lib/server/world-map-v3-provenance.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

const REGION = 'reg-aaaa';

describe('Causal Cartography — traceRegionProvenance (Slice 5 PR-E / D6)', () => {
	let db: Db;
	let userId: string;
	let mapId: string;

	async function event(name: string): Promise<string> {
		const [e] = await db.insert(entities).values({ userId, type: 'Event', name }).returning();
		return e.id;
	}
	async function causedBy(
		effect: string,
		cause: string,
		startPosition: number | null = null,
		revealedAtPosition: number | null = null
	) {
		// relationships_position_order is both-or-neither with start < end (D3),
		// so a scoped edge carries an endPosition too; the walk reads startPosition.
		const endPosition = startPosition === null ? null : startPosition + 0.25;
		await db.insert(relationships).values({
			userId,
			fromId: effect,
			toId: cause,
			type: 'caused_by',
			startPosition,
			endPosition,
			revealedAtPosition
		});
	}
	async function transferRegion(
		sourceEventId: string | null,
		tPosition = 0,
		opts: { undone?: boolean } = {}
	) {
		await db.insert(mapEvents).values({
			worldMapId: mapId,
			tPosition,
			kind: 'transfer_region',
			payloadJsonb: { region_id: REGION, new_faction_id: 'fac-x' },
			sourceEventId,
			undoneAt: opts.undone ? new Date() : null
		});
	}

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		[mapId] = (await db.insert(worldMaps).values({ userId, name: 'Map' }).returning()).map((m) => m.id);
	});

	it('linear chain: source → mid → root returns the root as earliest, ordered, with jump position', async () => {
		// caused_by is effect ← cause: source's cause is mid; mid's cause is root.
		const root = await event('Root cause');
		const mid = await event('Middle');
		const source = await event('Recorded cause');
		await causedBy(source, mid, 0.5);
		await causedBy(mid, root, 1.5); // edge INTO the root carries the jump position
		await transferRegion(source);

		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('found');
		if (r.status !== 'found') return;
		expect(r.chain.map((s) => s.eventId)).toEqual([source, mid, root]);
		expect(r.chain.map((s) => s.name)).toEqual(['Recorded cause', 'Middle', 'Root cause']);
		expect(r.earliest.eventId).toBe(root);
		expect(r.jumpPosition).toBe(1.5);
	});

	it('cycle (a → b → a): BFS terminates, does not hang or revisit', async () => {
		const a = await event('A');
		const b = await event('B');
		await causedBy(a, b);
		await causedBy(b, a); // cycle — caused_by is not cycle-checked at write
		await transferRegion(a);

		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('found');
		if (r.status !== 'found') return;
		// Visited once each; deepest reachable is b.
		expect(r.chain.map((s) => s.eventId)).toEqual([a, b]);
		expect(r.earliest.eventId).toBe(b);
	});

	it('cross-user ancestor: walk stops at the ownership boundary', async () => {
		const otherUserId = (await seedTestUser(db, { email: 'other@example.com' })).id;
		const source = await event('Owned cause');
		// A caused_by edge into an Event owned by another user.
		const [foreign] = await db
			.insert(entities)
			.values({ userId: otherUserId, type: 'Event', name: 'Foreign cause' })
			.returning();
		await db
			.insert(relationships)
			.values({ userId, fromId: source, toId: foreign.id, type: 'caused_by' });
		await transferRegion(source);

		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('found');
		if (r.status !== 'found') return;
		// The foreign ancestor is excluded; the chain is just the owned source.
		expect(r.chain.map((s) => s.eventId)).toEqual([source]);
		expect(r.earliest.eventId).toBe(source);
		expect(r.jumpPosition).toBeNull();
	});

	it('null source_event_id → no recorded cause', async () => {
		await transferRegion(null);
		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('no-cause');
	});

	it('no transfer_region for the region at/before T → no change', async () => {
		const source = await event('cause');
		await transferRegion(source, 5); // change is at t=5
		const r = await traceRegionProvenance(db, userId, mapId, REGION, 3); // ask at t=3
		expect(r.status).toBe('no-change');
	});

	it('deleted source Event (FK SET NULL leaves a null) → no recorded cause', async () => {
		// Simulate the post-delete state directly: a change whose source is null.
		await transferRegion(null, 0);
		const r = await traceRegionProvenance(db, userId, mapId, REGION, 0);
		expect(r.status).toBe('no-cause');
	});

	it('mystery: a not-yet-revealed caused_by edge is excluded; the walk stops, then reveals later', async () => {
		const hidden = await event('Hidden cause');
		const source = await event('Recorded cause');
		// Edge source ← hidden is revealed only at position 5.
		await causedBy(source, hidden, /* startPosition */ 4, /* revealedAtPosition */ 5);
		await transferRegion(source);

		// Before the reveal: the hidden cause must NOT leak — chain stops at source.
		const before = await traceRegionProvenance(db, userId, mapId, REGION, 3);
		expect(before.status).toBe('found');
		if (before.status === 'found') {
			expect(before.chain.map((s) => s.eventId)).toEqual([source]);
			expect(before.earliest.eventId).toBe(source);
		}
		// At/after the reveal: the hidden cause is now part of the lineage.
		const after = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(after.status).toBe('found');
		if (after.status === 'found') {
			expect(after.chain.map((s) => s.eventId)).toEqual([source, hidden]);
			expect(after.earliest.eventId).toBe(hidden);
		}
	});

	it('re-converging DAG: earliest is a true root, not merely the BFS-deepest node', async () => {
		// source → b → root  AND  source → c → d → root. `root` is the only true
		// root (no outgoing cause); d is BFS-deeper on one path but is NOT a root.
		const root = await event('Root');
		const b = await event('B');
		const c = await event('C');
		const d = await event('D');
		const source = await event('Source');
		await causedBy(source, b);
		await causedBy(b, root);
		await causedBy(source, c);
		await causedBy(c, d);
		await causedBy(d, root);
		await transferRegion(source);

		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('found');
		if (r.status !== 'found') return;
		// root has no outgoing cause → it is THE earliest, regardless of which
		// path the BFS tree reconstructs to reach it.
		expect(r.earliest.eventId).toBe(root);
		expect(r.chain[0].eventId).toBe(source);
		expect(r.chain[r.chain.length - 1].eventId).toBe(root);
	});

	it('multiple transfers at different T: the latest change ≤ T determines the cause', async () => {
		const causeEarly = await event('Cause @2');
		const causeLate = await event('Cause @8');
		await transferRegion(causeEarly, 2);
		await transferRegion(causeLate, 8);

		const at5 = await traceRegionProvenance(db, userId, mapId, REGION, 5);
		expect(at5.status === 'found' && at5.earliest.eventId).toBe(causeEarly);
		const at10 = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(at10.status === 'found' && at10.earliest.eventId).toBe(causeLate);
	});

	it('undone (soft-deleted) change is ignored', async () => {
		const live = await event('Live cause');
		await transferRegion(live, 2); // live change at t=2
		await transferRegion(await event('Undone cause'), 8, { undone: true }); // later but undone
		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		// The undone t=8 change is skipped; the live t=2 change wins.
		expect(r.status === 'found' && r.earliest.eventId).toBe(live);
	});

	it('same-T tie-break: highest (createdAt,id) change wins, deterministically', async () => {
		const first = await event('First @5');
		const second = await event('Second @5');
		await transferRegion(first, 5);
		await transferRegion(second, 5); // same tPosition, later createdAt → wins
		const r = await traceRegionProvenance(db, userId, mapId, REGION, 5);
		expect(r.status === 'found' && r.earliest.eventId).toBe(second);
	});

	it('re-converging DAG: earliest = the LONGEST-path root, not the first-reached one (Codex #66)', async () => {
		// source → a → rootZ ; source → b → a ; source → b → rootA.
		// Longest path to rootZ is source→b→a→rootZ (3); rootA is source→b→rootA (2).
		// A shortest-path BFS would tag rootZ via source→a→rootZ (2), tie with rootA
		// and pick by id; longest-path relaxation must pick rootZ outright.
		const source = await event('source');
		const a = await event('a');
		const b = await event('b');
		const rootZ = await event('rootZ');
		const rootA = await event('rootA');
		await causedBy(source, a);
		await causedBy(a, rootZ);
		await causedBy(source, b);
		await causedBy(b, a);
		await causedBy(b, rootA);
		await transferRegion(source);

		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('found');
		if (r.status !== 'found') return;
		expect(r.earliest.eventId).toBe(rootZ);
		// Chain reconstructs along the longest path: source → b → a → rootZ.
		expect(r.chain.map((s) => s.eventId)).toEqual([source, b, a, rootZ]);
	});

	it('unowned relationship row is excluded even if it references the caller’s Events (Codex #66)', async () => {
		const otherUserId = (await seedTestUser(db, { email: 'other2@example.com' })).id;
		const source = await event('Owned source');
		const ghostCause = await event('Cause via foreign edge'); // entity owned by caller
		// A caused_by row owned by ANOTHER user that points at the caller's Events
		// (imported / null-user style). entities.userId scoping alone would let this
		// through; the relationships.userId predicate must drop it.
		await db.insert(relationships).values({
			userId: otherUserId,
			fromId: source,
			toId: ghostCause,
			type: 'caused_by'
		});
		await transferRegion(source);

		const r = await traceRegionProvenance(db, userId, mapId, REGION, 10);
		expect(r.status).toBe('found');
		if (r.status !== 'found') return;
		// The foreign-owned edge is not followed → chain is just the owned source.
		expect(r.chain.map((s) => s.eventId)).toEqual([source]);
		expect(r.earliest.eventId).toBe(source);
	});
});
