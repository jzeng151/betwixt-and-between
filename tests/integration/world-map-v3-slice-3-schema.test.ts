/**
 * Slice 3 PR A schema invariants.
 *
 * Covers the five migrations landing together in PR A:
 *   • 0018 — world_maps grid columns + CHECK bounds
 *   • 0019 — map_anchors.is_synthetic
 *   • 0020 — map_events.command_id + partial index
 *   • 0021 — world_map_layer_prefs table + bump_updated_at trigger
 *   • 0022 — anchor cells backfill
 *
 * Each block asserts what the migration is supposed to guarantee, not
 * how the server-side code uses it. Server-side semantics land in
 * PR B (auto-anchor, payload cap) and PR D (layer-prefs CRUD) — those
 * get their own tests then.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql, and } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import {
	worldMaps,
	mapAnchors,
	mapEvents,
	worldMapLayerPrefs
} from '../../src/lib/server/db/schema.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedMap(db: Db, userId: string, name = 'test map'): Promise<string> {
	const [row] = await db
		.insert(worldMaps)
		.values({ userId, name })
		.returning({ id: worldMaps.id });
	return row.id;
}

describe('Slice 3 PR A — 0018 world_maps grid columns', () => {
	let db: Db;
	let userId: string;

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
	});

	it('new world_maps rows pick up grid defaults (square / 32x24 / m / 5.0 / visible=true)', async () => {
		const mapId = await seedMap(db, userId);
		const [row] = await db.select().from(worldMaps).where(eq(worldMaps.id, mapId));
		expect(row.gridType).toBe('square');
		expect(row.gridCellsX).toBe(32);
		expect(row.gridCellsY).toBe(24);
		expect(row.gridScaleUnit).toBe('m');
		expect(row.gridScaleValue).toBe(5.0);
		// Two-pass default (outside-voice B9a): after migration runs,
		// the new-row default is true. (Pre-existing rows backfilled
		// false; the backfill case can't be tested in a fresh PGlite
		// DB — covered by Neon-side migration smoke.)
		expect(row.gridVisible).toBe(true);
	});

	it('grid_type CHECK rejects values other than square|hex', async () => {
		await expect(
			db.execute(
				sql`INSERT INTO world_maps (user_id, name, grid_type) VALUES (${userId}, 'bad', 'triangle')`
			)
		).rejects.toThrow();
	});

	it('grid_type accepts hex', async () => {
		await db.execute(
			sql`INSERT INTO world_maps (user_id, name, grid_type) VALUES (${userId}, 'hex map', 'hex')`
		);
		const rows = await db
			.select({ gridType: worldMaps.gridType })
			.from(worldMaps)
			.where(eq(worldMaps.name, 'hex map'));
		expect(rows[0].gridType).toBe('hex');
	});

	it('grid_cells_x CHECK rejects 3 (below lower bound 4)', async () => {
		await expect(
			db.execute(
				sql`INSERT INTO world_maps (user_id, name, grid_cells_x) VALUES (${userId}, 'too small', 3)`
			)
		).rejects.toThrow();
	});

	it('grid_cells_y CHECK rejects 129 (above upper bound 128)', async () => {
		await expect(
			db.execute(
				sql`INSERT INTO world_maps (user_id, name, grid_cells_y) VALUES (${userId}, 'too big', 129)`
			)
		).rejects.toThrow();
	});

	it('grid_cells_x and grid_cells_y both at bounds (4 and 128) accepted', async () => {
		await db.execute(
			sql`INSERT INTO world_maps (user_id, name, grid_cells_x, grid_cells_y) VALUES (${userId}, 'tiny', 4, 4)`
		);
		await db.execute(
			sql`INSERT INTO world_maps (user_id, name, grid_cells_x, grid_cells_y) VALUES (${userId}, 'huge', 128, 128)`
		);
		const rows = await db
			.select({ name: worldMaps.name, x: worldMaps.gridCellsX, y: worldMaps.gridCellsY })
			.from(worldMaps);
		const tiny = rows.find((r) => r.name === 'tiny');
		const huge = rows.find((r) => r.name === 'huge');
		expect(tiny).toEqual({ name: 'tiny', x: 4, y: 4 });
		expect(huge).toEqual({ name: 'huge', x: 128, y: 128 });
	});
});

describe('Slice 3 PR A — 0019 map_anchors.is_synthetic', () => {
	let db: Db;
	let userId: string;
	let mapId: string;

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		mapId = await seedMap(db, userId);
	});

	it('new anchors default to is_synthetic=false (user-authored)', async () => {
		const [row] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: mapId,
				tPosition: 1.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], cells: [] }
			})
			.returning({ isSynthetic: mapAnchors.isSynthetic });
		expect(row.isSynthetic).toBe(false);
	});

	it('is_synthetic=true can be set explicitly (server auto-anchor path)', async () => {
		const [row] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: mapId,
				tPosition: 2.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], cells: [] },
				isSynthetic: true
			})
			.returning({ isSynthetic: mapAnchors.isSynthetic });
		expect(row.isSynthetic).toBe(true);
	});

	it('manually-inserted -Infinity baseline anchor carries is_synthetic=false', async () => {
		// 0012's runtime backfill seeded baseline anchors for every
		// world_maps row at migration time. PGlite tests create maps
		// AFTER all migrations run, so the backfill doesn't fire here
		// — Neon-side migration covers that one-shot path. The
		// invariant we CAN test in PGlite: inserting a fresh -Infinity
		// anchor (the same shape the backfill would have written)
		// defaults is_synthetic to false, because user-authored
		// anchors must not be marked synthetic.
		await db.insert(mapAnchors).values({
			worldMapId: mapId,
			tPosition: sql`'-Infinity'::float8` as unknown as number,
			stateJsonb: { regions: [], artifacts: [], chains: [], cells: [] }
		});
		const rows = await db
			.select({ isSynthetic: mapAnchors.isSynthetic })
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, mapId));
		expect(rows.length).toBe(1);
		expect(rows[0].isSynthetic).toBe(false);
	});
});

describe('Slice 3 PR A — 0020 map_events.command_id', () => {
	let db: Db;
	let userId: string;
	let mapId: string;

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		mapId = await seedMap(db, userId);
	});

	it('events default to command_id=NULL (standalone / legacy)', async () => {
		const [row] = await db
			.insert(mapEvents)
			.values({
				worldMapId: mapId,
				tPosition: 1.0,
				kind: 'transfer_region',
				payloadJsonb: { region_id: '00000000-0000-0000-0000-000000000001', new_faction_id: null }
			})
			.returning({ commandId: mapEvents.commandId });
		expect(row.commandId).toBeNull();
	});

	it('events sharing a command_id can be inserted (chunked stroke)', async () => {
		const commandId = '11111111-1111-1111-1111-111111111111';
		await db.insert(mapEvents).values({
			worldMapId: mapId,
			tPosition: 2.0,
			kind: 'paint_cells',
			payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'forest' }] },
			commandId
		});
		await db.insert(mapEvents).values({
			worldMapId: mapId,
			tPosition: 2.0,
			kind: 'paint_cells',
			payloadJsonb: { cells: [{ x: 1, y: 0, biome: 'forest' }] },
			commandId
		});
		const rows = await db
			.select({ id: mapEvents.id, commandId: mapEvents.commandId })
			.from(mapEvents)
			.where(eq(mapEvents.commandId, commandId));
		expect(rows.length).toBe(2);
	});
});

describe('Slice 3 PR A — 0021 world_map_layer_prefs', () => {
	let db: Db;
	let userA: string;
	let userB: string;
	let mapA: string;
	let mapB: string;

	beforeEach(async () => {
		db = await createTestDb();
		userA = (await seedTestUser(db, { email: 'a@test.com' })).id;
		userB = (await seedTestUser(db, { email: 'b@test.com' })).id;
		mapA = await seedMap(db, userA, 'A map');
		mapB = await seedMap(db, userB, 'B map');
	});

	it('insert + read round-trip (visible=1 default)', async () => {
		await db.insert(worldMapLayerPrefs).values({
			userId: userA,
			worldMapId: mapA,
			layerKey: 'terrain'
		});
		const [row] = await db
			.select()
			.from(worldMapLayerPrefs)
			.where(
				and(
					eq(worldMapLayerPrefs.userId, userA),
					eq(worldMapLayerPrefs.worldMapId, mapA),
					eq(worldMapLayerPrefs.layerKey, 'terrain')
				)
			);
		expect(row.visible).toBe(1);
		expect(row.createdAt).toBeDefined();
		expect(row.updatedAt).toBeDefined();
	});

	it('composite PK rejects duplicate (user, map, layer_key)', async () => {
		await db.insert(worldMapLayerPrefs).values({
			userId: userA,
			worldMapId: mapA,
			layerKey: 'grid'
		});
		await expect(
			db.insert(worldMapLayerPrefs).values({
				userId: userA,
				worldMapId: mapA,
				layerKey: 'grid'
			})
		).rejects.toThrow();
	});

	it('same user can have prefs for the same layer on different maps', async () => {
		// Same user on map A and map B (which they don't own — table
		// does NOT enforce ownership; that lives at the server-side
		// write helper). Schema test only checks the PK shape.
		await db.insert(worldMapLayerPrefs).values({
			userId: userA,
			worldMapId: mapA,
			layerKey: 'grid'
		});
		await db.insert(worldMapLayerPrefs).values({
			userId: userA,
			worldMapId: mapB,
			layerKey: 'grid'
		});
		const rows = await db
			.select()
			.from(worldMapLayerPrefs)
			.where(eq(worldMapLayerPrefs.userId, userA));
		expect(rows.length).toBe(2);
	});

	it('bump_updated_at trigger fires on UPDATE', async () => {
		await db.insert(worldMapLayerPrefs).values({
			userId: userA,
			worldMapId: mapA,
			layerKey: 'placements'
		});
		const [before] = await db
			.select({ updatedAt: worldMapLayerPrefs.updatedAt })
			.from(worldMapLayerPrefs)
			.where(
				and(
					eq(worldMapLayerPrefs.userId, userA),
					eq(worldMapLayerPrefs.worldMapId, mapA),
					eq(worldMapLayerPrefs.layerKey, 'placements')
				)
			);
		// Tiny delay so updated_at can advance.
		await new Promise((r) => setTimeout(r, 10));
		await db
			.update(worldMapLayerPrefs)
			.set({ visible: 0 })
			.where(
				and(
					eq(worldMapLayerPrefs.userId, userA),
					eq(worldMapLayerPrefs.worldMapId, mapA),
					eq(worldMapLayerPrefs.layerKey, 'placements')
				)
			);
		const [after] = await db
			.select({ updatedAt: worldMapLayerPrefs.updatedAt, visible: worldMapLayerPrefs.visible })
			.from(worldMapLayerPrefs)
			.where(
				and(
					eq(worldMapLayerPrefs.userId, userA),
					eq(worldMapLayerPrefs.worldMapId, mapA),
					eq(worldMapLayerPrefs.layerKey, 'placements')
				)
			);
		expect(after.visible).toBe(0);
		expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
	});

	it('cascade delete: removing a world_map deletes its layer_prefs', async () => {
		await db.insert(worldMapLayerPrefs).values({
			userId: userA,
			worldMapId: mapA,
			layerKey: 'chrome'
		});
		await db.delete(worldMaps).where(eq(worldMaps.id, mapA));
		const rows = await db
			.select()
			.from(worldMapLayerPrefs)
			.where(eq(worldMapLayerPrefs.worldMapId, mapA));
		expect(rows.length).toBe(0);
	});
});

describe('Slice 3 PR A — 0022 anchor cells backfill', () => {
	let db: Db;
	let userId: string;
	let mapId: string;

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		mapId = await seedMap(db, userId);
	});

	it('0022 backfill writes cells: [] into pre-Slice-3 anchor shape', async () => {
		// 0012's runtime backfill of baseline anchors only fires for
		// world_maps rows that exist at migration time. PGlite tests
		// create maps post-migration, so we simulate the pre-Slice-3
		// anchor shape by inserting an anchor whose state_jsonb
		// lacks the cells key. Re-running 0022's backfill SQL must
		// then add cells: [] to that anchor.
		await db.insert(mapAnchors).values({
			worldMapId: mapId,
			tPosition: 1.0,
			stateJsonb: { regions: [], artifacts: [], chains: [] }
		});
		// Re-apply the 0022 backfill mechanic.
		await db.execute(sql`
			UPDATE map_anchors
			SET state_jsonb = jsonb_set(
				state_jsonb,
				'{cells}',
				'[]'::jsonb,
				true
			)
			WHERE NOT (state_jsonb ? 'cells')
		`);
		const [row] = await db
			.select({ state: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, mapId), eq(mapAnchors.tPosition, 1.0)));
		const state = row.state as Record<string, unknown>;
		expect(state).toHaveProperty('cells');
		expect(state.cells).toEqual([]);
	});

	it('0022 is idempotent — anchor with existing cells field unchanged', async () => {
		// Insert a fresh anchor that ALREADY has cells populated.
		// Re-running the backfill (via direct SQL) should not overwrite.
		await db.insert(mapAnchors).values({
			worldMapId: mapId,
			tPosition: 9.0,
			stateJsonb: {
				regions: [],
				artifacts: [],
				chains: [],
				cells: [{ x: 5, y: 5, biome: 'forest' }]
			}
		});
		// Re-apply the backfill mechanic (idempotency check).
		await db.execute(sql`
			UPDATE map_anchors
			SET state_jsonb = jsonb_set(
				state_jsonb,
				'{cells}',
				'[]'::jsonb,
				true
			)
			WHERE NOT (state_jsonb ? 'cells')
		`);
		const [row] = await db
			.select({ state: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, mapId), eq(mapAnchors.tPosition, 9.0)));
		const state = row.state as Record<string, unknown>;
		expect(state.cells).toEqual([{ x: 5, y: 5, biome: 'forest' }]);
	});
});
