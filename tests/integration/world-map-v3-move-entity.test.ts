import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../src/lib/server/db/schema.js';
import { createMapEvent, undoLatestMapEvent, listMapEvents } from '../../src/lib/server/world-map-v3.js';
import type { Db } from '../../src/lib/server/intervals.js';

// Slice 4 PR-F (D5) — move_entity validator coverage.
//
// The validator's job (world-map-v3.ts validateMoveEntityPayload):
//   - shape: position {x,y} finite + [0,1], tween in {linear, ease_in_out}
//   - D-PRF-8 cross-scope: placement_id resolves through the active map's
//     LOCATION + the caller's user_id (NOT map_id). A foreign placement_id
//     (other location or other user) must be rejected at write — the
//     CLAUDE.md "missing JOIN is a cross-user leak" class.
//   - D-PRF-9 window: keyframe t_position must fall in the placement's active
//     window [start, end); out-of-window is rejected at write.

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');

function loadMigrations(): string[] {
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	const out: string[] = [];
	for (const f of files) {
		const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
		const parts = sql
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter(Boolean);
		out.push(...parts);
	}
	return out;
}

// `db` keeps drizzle's inferred (loose-schema) type so direct .insert() calls
// type-check; `serverDb()` casts it to the schema-bound `Db` the server fns
// want. createMapEvent's signature is stricter than drizzle's runtime shape, so
// the cast is a test-only bridge (same engine, PGlite).
let db: ReturnType<typeof drizzle>;
let client: PGlite;
const serverDb = (): Db => db as unknown as Db;
let userId: string;
let otherUserId: string;
let locationId: string;
let worldMapId: string;
let placeableId: string;
/** Default-window placement (both bounds null → always active). */
let placementId: string;

async function newUser(): Promise<string> {
	const [u] = await db
		.insert(schema.user)
		.values({ name: 'T', email: `t-${crypto.randomUUID()}@e.com`, emailVerified: true })
		.returning();
	return u.id;
}

async function newEntity(
	uid: string,
	type: (typeof schema.EntityType)[number]
): Promise<string> {
	const [e] = await db
		.insert(schema.entities)
		.values({ userId: uid, type, name: `${type}-${crypto.randomUUID()}` })
		.returning();
	return e.id;
}

beforeEach(async () => {
	client = new PGlite({ extensions: { btree_gist } });
	await client.waitReady;
	db = drizzle(client, { schema });
	for (const stmt of loadMigrations()) {
		await client.exec(stmt);
	}

	userId = await newUser();
	otherUserId = await newUser();

	// A Location anchors the map; placements are scoped to it.
	locationId = await newEntity(userId, 'Location');
	const [m] = await db
		.insert(schema.worldMaps)
		.values({ userId, name: 'M', locationId })
		.returning();
	worldMapId = m.id;

	// A placeable (Character) + a default-window placement in this location.
	// NOTE: explicit `id` on every map_placements insert. PGlite's
	// gen_random_uuid() is deterministic in-process, so two placements relying
	// on defaultRandom() collide on the primary key — the second silently wins
	// the row and the test's ids alias each other. crypto.randomUUID() in app
	// code keeps them distinct.
	placeableId = await newEntity(userId, 'Character');
	const [p] = await db
		.insert(schema.mapPlacements)
		.values({ id: crypto.randomUUID(), userId, placeableId, locationId, mapId: worldMapId, x: 0.5, y: 0.5 })
		.returning();
	placementId = p.id;
});

afterEach(async () => {
	await client.close();
});

const validPayload = (pid: string) => ({
	placement_id: pid,
	position: { x: 0.25, y: 0.75 },
	tween: 'linear' as const
});

describe('move_entity validator — happy path', () => {
	it('accepts a valid keyframe for a default-window placement', async () => {
		const ev = await createMapEvent(serverDb(), userId, worldMapId, {
			tPosition: 3,
			kind: 'move_entity',
			payloadJsonb: validPayload(placementId)
		});
		expect(ev.kind).toBe('move_entity');
	});

	it('accepts ease_in_out tween', async () => {
		const ev = await createMapEvent(serverDb(), userId, worldMapId, {
			tPosition: 3,
			kind: 'move_entity',
			payloadJsonb: { ...validPayload(placementId), tween: 'ease_in_out' }
		});
		expect(ev.kind).toBe('move_entity');
	});
});

describe('move_entity validator — payload shape (400)', () => {
	it('rejects a non-uuid placement_id', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: { placement_id: 'not-a-uuid', position: { x: 0.1, y: 0.1 }, tween: 'linear' }
			})
		).rejects.toThrow();
	});

	it('rejects an unknown tween', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: { placement_id: placementId, position: { x: 0.1, y: 0.1 }, tween: 'bounce' }
			})
		).rejects.toThrow();
	});

	it('rejects a non-finite position coordinate', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: { placement_id: placementId, position: { x: Number.NaN, y: 0.1 }, tween: 'linear' }
			})
		).rejects.toThrow();
	});

	it('rejects a position coordinate outside [0,1]', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: { placement_id: placementId, position: { x: 1.5, y: 0.1 }, tween: 'linear' }
			})
		).rejects.toThrow();
	});

	it('rejects a missing position object', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: { placement_id: placementId, tween: 'linear' }
			})
		).rejects.toThrow();
	});
});

describe('move_entity validator — cross-scope (D-PRF-8)', () => {
	it('rejects a placement in a DIFFERENT location (same user)', async () => {
		const otherLocation = await newEntity(userId, 'Location');
		const [foreign] = await db
			.insert(schema.mapPlacements)
			.values({ id: crypto.randomUUID(), userId, placeableId, locationId: otherLocation, x: 0.5, y: 0.5 })
			.returning();
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: validPayload(foreign.id)
			})
		).rejects.toThrow();
	});

	it('rejects a placement owned by a DIFFERENT user in the same location', async () => {
		// Same location id, but the placement row belongs to otherUserId. The
		// validator scopes on (location_id AND user_id), so this must fail.
		const [foreign] = await db
			.insert(schema.mapPlacements)
			.values({ id: crypto.randomUUID(), userId: otherUserId, placeableId, locationId, x: 0.5, y: 0.5 })
			.returning();
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: validPayload(foreign.id)
			})
		).rejects.toThrow();
	});

	it('rejects when the map has no linked location', async () => {
		const [noLocMap] = await db
			.insert(schema.worldMaps)
			.values({ userId, name: 'NoLoc' })
			.returning();
		await expect(
			createMapEvent(serverDb(), userId, noLocMap.id, {
				tPosition: 3,
				kind: 'move_entity',
				payloadJsonb: validPayload(placementId)
			})
		).rejects.toThrow();
	});
});

describe('move_entity validator — window (D-PRF-9)', () => {
	let windowedId: string;
	beforeEach(async () => {
		// Half-open active window [2, 8).
		const [wp] = await db
			.insert(schema.mapPlacements)
			.values({
				id: crypto.randomUUID(),
				userId,
				placeableId,
				locationId,
				x: 0.5,
				y: 0.5,
				startPosition: 2,
				endPosition: 8
			})
			.returning();
		windowedId = wp.id;
	});

	it('accepts a keyframe inside the window', async () => {
		const ev = await createMapEvent(serverDb(), userId, worldMapId, {
			tPosition: 5,
			kind: 'move_entity',
			payloadJsonb: validPayload(windowedId)
		});
		expect(ev.kind).toBe('move_entity');
	});

	it('accepts a keyframe at the window start (inclusive)', async () => {
		const ev = await createMapEvent(serverDb(), userId, worldMapId, {
			tPosition: 2,
			kind: 'move_entity',
			payloadJsonb: validPayload(windowedId)
		});
		expect(ev.kind).toBe('move_entity');
	});

	it('rejects a keyframe at the window end (exclusive)', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 8,
				kind: 'move_entity',
				payloadJsonb: validPayload(windowedId)
			})
		).rejects.toThrow();
	});

	it('rejects a keyframe before the window', async () => {
		await expect(
			createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: 1,
				kind: 'move_entity',
				payloadJsonb: validPayload(windowedId)
			})
		).rejects.toThrow();
	});
});

// D-PRF-11 — move_entity reuses /events/undo as-is (no keyframe-dependency
// subsystem). Undo soft-deletes the latest live event; the live list (which the
// projection folds) drops it, and prev/next re-span lazily at fold time. Here we
// pin the server path: author → the keyframe is live → undo → it's gone from the
// live set, and undoing on an empty history is a clean no-op.
describe('move_entity undo (D-PRF-11)', () => {
	async function liveMoveCount(): Promise<number> {
		const { rows } = await listMapEvents(serverDb(), userId, worldMapId, {});
		return rows.filter((r) => r.kind === 'move_entity').length;
	}

	it('author then undo removes the keyframe from the live set', async () => {
		await createMapEvent(serverDb(), userId, worldMapId, {
			tPosition: 3,
			kind: 'move_entity',
			payloadJsonb: validPayload(placementId)
		});
		expect(await liveMoveCount()).toBe(1);

		const undone = await undoLatestMapEvent(serverDb(), userId, worldMapId);
		expect(undone.map((e) => e.kind)).toContain('move_entity');
		expect(await liveMoveCount()).toBe(0);
	});

	it('undo of a middle keyframe leaves the others live (LIFO pop of the latest)', async () => {
		// Three keyframes for the default-window placement at distinct T.
		for (const t of [2, 4, 6]) {
			await createMapEvent(serverDb(), userId, worldMapId, {
				tPosition: t,
				kind: 'move_entity',
				payloadJsonb: validPayload(placementId)
			});
		}
		expect(await liveMoveCount()).toBe(3);
		// Undo pops the most recently committed keyframe; the other two survive
		// and the projection re-spans across them (verified at the fold in the
		// projection-movement unit suite).
		await undoLatestMapEvent(serverDb(), userId, worldMapId);
		expect(await liveMoveCount()).toBe(2);
	});
});
