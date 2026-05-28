/**
 * Slice 3 PR B server-side tests for paint_cells.
 *
 * Covers:
 *   B.1 — projection.ts paint_cells fold (last-write-wins on (x,y); same-T
 *         ordering preserved).
 *   B.2 — validateEventPayload: biome enum, cell bounds against
 *         world_maps.grid_cells_*, 256-cell cap, commandId UUID format,
 *         command_complete boolean.
 *   B.4 — undoLatestMapEvent groups by command_id (chunked-stroke undo
 *         soft-deletes all rows sharing a commandId atomically).
 *   B.5 — auto-anchor fires at K=20 non-undone paint_cells events with
 *         stroke-boundary deferral (command_complete=false suppresses).
 *
 * Calls handler functions directly with mock RequestEvent — same shape
 * as tests/integration/api-maps.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, asc, sql } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { mapAnchors, mapEvents, worldMaps } from '../../src/lib/server/db/schema.js';
import { projectState, type ProjectionContext } from '../../src/lib/features/map/projection.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

const { POST: CREATE_MAP } = await import('../../src/routes/api/maps/+server.js');
const { POST: CREATE_EVENT } = await import(
	'../../src/routes/api/maps/[id]/events/+server.js'
);
const { POST: UNDO_EVENT } = await import(
	'../../src/routes/api/maps/[id]/events/undo/+server.js'
);
const { DELETE: DELETE_EVENT } = await import(
	'../../src/routes/api/maps/[id]/events/[eventId]/+server.js'
);
const { POST: CREATE_ANCHOR } = await import(
	'../../src/routes/api/maps/[id]/anchors/+server.js'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkEvent(overrides: { params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: new URL('http://localhost/'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true },
			session: {
				id: crypto.randomUUID(),
				userId,
				expiresAt: new Date(Date.now() + 86400000),
				token: 'test-token'
			}
		}
	};
}

async function readJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

async function seedMap(name = 'M'): Promise<{ id: string }> {
	const res = await CREATE_MAP(mkEvent({ body: { name } }));
	return (await readJson(res)) as { id: string };
}

const emptyCtx: ProjectionContext = {
	allowedFactions: new Map(),
	allowedRegions: new Set()
};

describe('Slice 3 B.1 — projection paint_cells fold', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('folds cells from anchor and event in last-write-wins order', () => {
		const anchor = {
			id: 'a1',
			tPosition: 0,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			stateJsonb: {
				regions: [],
				artifacts: [],
				chains: [],
				cells: [{ x: 0, y: 0, biome: 'plains' as const }]
			}
		};
		const event = {
			id: 'e1',
			tPosition: 1,
			kind: 'paint_cells',
			createdAt: new Date('2026-01-01T00:00:01Z'),
			payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'forest' }] }
		};
		const state = projectState(2, [anchor], [event], emptyCtx);
		expect(state.cells).toEqual([{ x: 0, y: 0, biome: 'forest' }]);
	});

	it('events at exactly anchor.t are excluded from the cells fold (same-T rule)', () => {
		const anchor = {
			id: 'a1',
			tPosition: 5,
			createdAt: new Date('2026-01-01T00:00:00Z'),
			stateJsonb: {
				regions: [],
				artifacts: [],
				chains: [],
				cells: [{ x: 1, y: 1, biome: 'plains' as const }]
			}
		};
		const eventAtAnchorT = {
			id: 'e1',
			tPosition: 5,
			kind: 'paint_cells',
			createdAt: new Date('2026-01-01T00:00:01Z'),
			payloadJsonb: { cells: [{ x: 1, y: 1, biome: 'water' }] }
		};
		const state = projectState(5, [anchor], [eventAtAnchorT], emptyCtx);
		// Anchor's plains wins — the event at T is pre-anchor per CMT-5.
		expect(state.cells).toEqual([{ x: 1, y: 1, biome: 'plains' }]);
	});

	it('two events on same (x,y) — later (createdAt) wins', () => {
		const earlier = {
			id: 'e1',
			tPosition: 1,
			kind: 'paint_cells',
			createdAt: new Date('2026-01-01T00:00:00Z'),
			payloadJsonb: { cells: [{ x: 2, y: 2, biome: 'desert' }] }
		};
		const later = {
			id: 'e2',
			tPosition: 1,
			kind: 'paint_cells',
			createdAt: new Date('2026-01-01T00:00:01Z'),
			payloadJsonb: { cells: [{ x: 2, y: 2, biome: 'snow' }] }
		};
		const state = projectState(2, [], [later, earlier], emptyCtx);
		expect(state.cells).toEqual([{ x: 2, y: 2, biome: 'snow' }]);
	});

	it('unknown biome silently dropped (lazy GC) at render', () => {
		const event = {
			id: 'e1',
			tPosition: 1,
			kind: 'paint_cells',
			createdAt: new Date('2026-01-01T00:00:00Z'),
			payloadJsonb: { cells: [{ x: 3, y: 3, biome: 'magma' }] }
		};
		const state = projectState(2, [], [event], emptyCtx);
		expect(state.cells).toEqual([]);
	});

	it('eraser-painted unset is emitted as a stored cell (renderer treats as transparent)', () => {
		const event = {
			id: 'e1',
			tPosition: 1,
			kind: 'paint_cells',
			createdAt: new Date('2026-01-01T00:00:00Z'),
			payloadJsonb: { cells: [{ x: 4, y: 4, biome: 'unset' }] }
		};
		const state = projectState(2, [], [event], emptyCtx);
		expect(state.cells).toEqual([{ x: 4, y: 4, biome: 'unset' }]);
	});
});

describe('Slice 3 B.2 — paint_cells server validator', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('accepts a happy-path single-cell paint event', async () => {
		const map = await seedMap();
		const res = await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 1,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'forest' }] }
				}
			})
		);
		expect(res.status).toBe(201);
	});

	it('rejects unknown biome with 400', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'lava' }] }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects out-of-bounds x with 400 (defaults: grid_cells_x=32)', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: 32, y: 0, biome: 'plains' }] }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects out-of-bounds y with 400 (defaults: grid_cells_y=24)', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: 0, y: 24, biome: 'plains' }] }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects negative x with 400', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: -1, y: 0, biome: 'plains' }] }
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects empty cells array with 400', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: { tPosition: 1, kind: 'paint_cells', payloadJsonb: { cells: [] } }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects > 256 cells with 400 (A3 cap)', async () => {
		const map = await seedMap();
		const cells = Array.from({ length: 257 }, (_, i) => ({
			x: i % 32,
			y: Math.floor(i / 32) % 24,
			biome: 'plains' as const
		}));
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: { tPosition: 1, kind: 'paint_cells', payloadJsonb: { cells } }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts exactly 256 cells (cap edge)', async () => {
		const map = await seedMap();
		const cells = Array.from({ length: 256 }, (_, i) => ({
			x: i % 32,
			y: Math.floor(i / 32) % 24,
			biome: 'plains' as const
		}));
		const res = await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 1, kind: 'paint_cells', payloadJsonb: { cells } }
			})
		);
		expect(res.status).toBe(201);
	});

	it('rejects malformed commandId (not a UUID) with 400', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'plains' }] },
						commandId: 'not-a-uuid'
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-boolean command_complete with 400', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_cells',
						payloadJsonb: {
							cells: [{ x: 0, y: 0, biome: 'plains' }],
							command_complete: 'yes'
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('Slice 3 B.4 — chunked-stroke undo grouping', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('undo on a standalone paint_cells event returns one-element array', async () => {
		const map = await seedMap();
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 1,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'forest' }] }
				}
			})
		);
		const res = await UNDO_EVENT(mkEvent({ params: { id: map.id } }));
		const popped = (await readJson(res)) as unknown[];
		expect(Array.isArray(popped)).toBe(true);
		expect(popped).toHaveLength(1);
	});

	it('undo on a chunked stroke pops all sibling rows atomically', async () => {
		const map = await seedMap();
		const strokeId = crypto.randomUUID();
		// Three chunks sharing the same commandId. Only the last sets
		// command_complete so the auto-anchor doesn't fire mid-stroke.
		for (let i = 0; i < 3; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: {
							cells: [{ x: i, y: 0, biome: 'forest' }],
							command_complete: i === 2
						},
						commandId: strokeId
					}
				})
			);
		}
		const res = await UNDO_EVENT(mkEvent({ params: { id: map.id } }));
		const popped = (await readJson(res)) as Array<{ id: string; commandId: string }>;
		expect(popped).toHaveLength(3);
		for (const row of popped) {
			expect(row.commandId).toBe(strokeId);
		}
		// All three soft-deleted; none remain live.
		const live = await currentDb
			.select({ id: mapEvents.id })
			.from(mapEvents)
			.where(
				and(eq(mapEvents.worldMapId, map.id), sql`${mapEvents.undoneAt} IS NULL`)
			);
		expect(live).toHaveLength(0);
	});

	it('NULL command_id rows do not get pulled in by a sibling group undo', async () => {
		const map = await seedMap();
		// One standalone event (NULL command_id), one grouped event with
		// command_id, both paint_cells. Undo pops the latest first; that's
		// the grouped one. The standalone must remain live.
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 1,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'plains' }] }
				}
			})
		);
		const strokeId = crypto.randomUUID();
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 2,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 1, y: 1, biome: 'snow' }], command_complete: true },
					commandId: strokeId
				}
			})
		);
		const res = await UNDO_EVENT(mkEvent({ params: { id: map.id } }));
		const popped = (await readJson(res)) as Array<{ commandId: string | null }>;
		expect(popped).toHaveLength(1);
		expect(popped[0].commandId).toBe(strokeId);
		const live = await currentDb
			.select({ id: mapEvents.id, commandId: mapEvents.commandId })
			.from(mapEvents)
			.where(
				and(eq(mapEvents.worldMapId, map.id), sql`${mapEvents.undoneAt} IS NULL`)
			);
		expect(live).toHaveLength(1);
		expect(live[0].commandId).toBeNull();
	});
});

describe('Slice 3 B.5 — auto-anchor tight rules', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('does NOT fire at 19 paint_cells events', async () => {
		const map = await seedMap();
		for (let i = 0; i < 19; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }] }
					}
				})
			);
		}
		const anchors = await currentDb
			.select({ isSynthetic: mapAnchors.isSynthetic })
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		const synthetic = anchors.filter((a) => a.isSynthetic);
		expect(synthetic).toHaveLength(0);
	});

	it('fires at 20 paint_cells events when the 20th is stroke-complete', async () => {
		const map = await seedMap();
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }] }
					}
				})
			);
		}
		const anchors = await currentDb
			.select({
				isSynthetic: mapAnchors.isSynthetic,
				tPosition: mapAnchors.tPosition,
				stateJsonb: mapAnchors.stateJsonb
			})
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id))
			.orderBy(asc(mapAnchors.createdAt));
		const synthetic = anchors.filter((a) => a.isSynthetic);
		expect(synthetic).toHaveLength(1);
		// Snapshot includes all 20 cells.
		const state = synthetic[0].stateJsonb as { cells: Array<{ x: number; biome: string }> };
		expect(state.cells).toHaveLength(20);
	});

	it('deferred mid-stroke: 20 chunks with command_complete=false suppress until last chunk', async () => {
		const map = await seedMap();
		const strokeId = crypto.randomUUID();
		// 20 chunks, none marked complete except the last. Auto-anchor must
		// only fire after the last chunk lands.
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: {
							cells: [{ x: i, y: 0, biome: 'plains' }],
							command_complete: i === 19
						},
						commandId: strokeId
					}
				})
			);
		}
		const synthetic = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(
				and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true))
			);
		expect(synthetic).toHaveLength(1);
	});

	it('undo invalidates synthetic anchors whose snapshots include the undone events (C.5)', async () => {
		// Set up: paint 20 events to trigger an auto-anchor, then undo
		// the latest. The synthetic anchor's snapshot included the
		// now-undone event, so it must be hard-deleted to avoid stale
		// projection state. Auto-anchor will re-fire on the next K=20.
		const map = await seedMap();
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }] }
					}
				})
			);
		}
		const beforeUndo = await currentDb
			.select({ id: mapAnchors.id, isSynthetic: mapAnchors.isSynthetic })
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		const syntheticBefore = beforeUndo.filter((a) => a.isSynthetic);
		expect(syntheticBefore).toHaveLength(1);

		// Undo the latest (synthetic anchor snapshot included it).
		await UNDO_EVENT(mkEvent({ params: { id: map.id } }));

		const afterUndo = await currentDb
			.select({ id: mapAnchors.id, isSynthetic: mapAnchors.isSynthetic })
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		const syntheticAfter = afterUndo.filter((a) => a.isSynthetic);
		// Synthetic anchor must be gone — its snapshot was stale.
		expect(syntheticAfter).toHaveLength(0);
		// User-authored baseline anchor (created by seedMap) must still
		// be there — only synthetic anchors are invalidated.
		const userAuthoredAfter = afterUndo.filter((a) => !a.isSynthetic);
		expect(userAuthoredAfter.length).toBeGreaterThan(0);
	});

	it('undo does NOT delete user-authored anchors (C.5)', async () => {
		// Belt-and-suspenders: hard-delete is gated on is_synthetic=true.
		// Even an aggressive undo cascade must leave user anchors alone.
		const map = await seedMap();
		// User-authored anchor snapshot at t=5.
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 5,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 0, y: 0, biome: 'forest' }] }
				}
			})
		);
		const userAnchorsBefore = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(
				and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, false))
			);

		// Undo — only the paint_cells event soft-deletes; no anchors
		// touched because none were synthetic.
		await UNDO_EVENT(mkEvent({ params: { id: map.id } }));

		const userAnchorsAfter = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(
				and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, false))
			);
		expect(userAnchorsAfter.length).toBe(userAnchorsBefore.length);
	});

	it('undone paint_cells events do NOT count toward the K=20 trigger', async () => {
		const map = await seedMap();
		// Land 15 events; undo 5 of them; land 10 more. Total non-undone = 20
		// (15 - 5 + 10). Auto-anchor must fire (count crosses K AFTER undo
		// since undone rows are excluded).
		for (let i = 0; i < 15; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }] }
					}
				})
			);
		}
		for (let i = 0; i < 5; i++) {
			await UNDO_EVENT(mkEvent({ params: { id: map.id } }));
		}
		// Live count now 10. Add 10 more.
		for (let i = 0; i < 10; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 10 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 1, biome: 'forest' }] }
					}
				})
			);
		}
		const synthetic = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(
				and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true))
			);
		expect(synthetic).toHaveLength(1);
	});
});

describe('Slice 3 codex P1 — same-T auto-anchor upsert', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('re-painting at the same playhead T upserts the synthetic anchor instead of dropping cells', async () => {
		const map = await seedMap();
		const T = 5;
		// 40 distinct cells within the default 32×24 grid: x = i % 16,
		// y = ⌊i/16⌋ keeps every coord in bounds while staying unique.
		const cellFor = (i: number) => ({ x: i % 16, y: Math.floor(i / 16), biome: 'plains' });
		// First 20 distinct cells at T → one synthetic anchor at T (20 cells).
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: T,
						kind: 'paint_cells',
						payloadJsonb: { cells: [cellFor(i)], command_complete: true }
					}
				})
			);
		}
		// Next 20 distinct cells, SAME T → the second auto-anchor hits the
		// (world_map_id, t_position) unique constraint. Pre-fix it swallowed
		// the conflict, leaving the stale 20-cell snapshot to shadow these
		// new same-T events (projection excludes events at t_position <= T),
		// so cells 20..39 silently vanished.
		for (let i = 20; i < 40; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: T,
						kind: 'paint_cells',
						payloadJsonb: { cells: [cellFor(i)], command_complete: true }
					}
				})
			);
		}
		const synthetic = await currentDb
			.select({ tPosition: mapAnchors.tPosition, stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		// Still exactly one synthetic anchor at T (the unique constraint holds)…
		expect(synthetic).toHaveLength(1);
		expect(synthetic[0].tPosition).toBe(T);
		// …but its snapshot was upserted to include all 40 distinct cells, so
		// no same-T paint is lost.
		const cells = (synthetic[0].stateJsonb as { cells: Array<{ x: number; y: number }> }).cells;
		expect(cells).toHaveLength(40);
		expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(40);
	});
});

describe('Slice 3 codex P2 — DELETE invalidates synthetic anchors', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('deleting a folded paint event removes the synthetic anchor that snapshotted it', async () => {
		const map = await seedMap();
		const eventIds: string[] = [];
		for (let i = 0; i < 20; i++) {
			const res = await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }], command_complete: true }
					}
				})
			);
			eventIds.push(((await readJson(res)) as { id: string }).id);
		}
		const before = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(before).toHaveLength(1);

		// DELETE a folded event via the API DELETE handler (NOT undo). Pre-fix
		// this soft-deleted the event but left the synthetic anchor's stale
		// snapshot rendering the now-deleted terrain.
		await DELETE_EVENT(mkEvent({ params: { id: map.id, eventId: eventIds[5] } }));

		const after = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(after).toHaveLength(0);
	});
});

describe('Slice 3 codex P2 follow-ups (iter 2 review)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('#7 same-T repaint refreshes the synthetic anchor created_at so undo/delete still invalidates it', async () => {
		const map = await seedMap();
		const T = 5;
		const cellFor = (i: number) => ({ x: i % 16, y: Math.floor(i / 16), biome: 'plains' });
		const secondBatchIds: string[] = [];
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: T,
						kind: 'paint_cells',
						payloadJsonb: { cells: [cellFor(i)], command_complete: true }
					}
				})
			);
		}
		for (let i = 20; i < 40; i++) {
			const res = await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: T,
						kind: 'paint_cells',
						payloadJsonb: { cells: [cellFor(i)], command_complete: true }
					}
				})
			);
			secondBatchIds.push(((await readJson(res)) as { id: string }).id);
		}
		// One synthetic anchor at T, snapshot has all 40 cells (the delete-then-
		// insert upsert gave it a created_at newer than every folded event).
		const before = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(before).toHaveLength(1);

		// Delete a SECOND-batch event (folded after the original anchor's
		// created_at). Pre-fix the in-place update kept the stale created_at,
		// so `created_at >= event.created_at` was false and the anchor survived
		// with the deleted cell still in its snapshot. With the fresh created_at
		// it's correctly invalidated.
		await DELETE_EVENT(mkEvent({ params: { id: map.id, eventId: secondBatchIds[5] } }));
		const after = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(after).toHaveLength(0);
	});

	it('#8 auto-anchor fold excludes retroactive events shadowed by the base anchor', async () => {
		const map = await seedMap();
		// Author a user anchor at T=10 carrying one cell.
		await CREATE_ANCHOR(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 10,
					stateJsonb: {
						regions: [],
						artifacts: [],
						chains: [],
						cells: [{ x: 1, y: 1, biome: 'plains' }]
					}
				}
			})
		);
		// 19 paints at T=11 (after the anchor) …
		for (let i = 0; i < 19; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 11,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 5, biome: 'plains' }], command_complete: true }
					}
				})
			);
		}
		// …then a 20th, RETROACTIVE paint at T=5 (< anchor T=10). It trips the
		// K=20 count, so the auto-anchor fires with maxT=11 and base = the
		// T=10 anchor. projectState(11) would shadow the T=5 cell behind that
		// anchor, so it must NOT appear in the synthetic snapshot.
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 5,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 9, y: 9, biome: 'forest' }], command_complete: true }
				}
			})
		);
		const synthetic = await currentDb
			.select({ stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(synthetic).toHaveLength(1);
		const cells = (synthetic[0].stateJsonb as { cells: Array<{ x: number; y: number }> }).cells;
		const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
		const keys = new Set(cells.map(key));
		expect(keys.has('1,1')).toBe(true); // inherited from the base anchor
		expect(keys.has('0,5')).toBe(true); // a T=11 paint (after the anchor)
		expect(keys.has('9,9')).toBe(false); // retroactive T=5 paint — shadowed
	});

	it('#9 authoring a user anchor invalidates later synthetic anchors', async () => {
		const map = await seedMap();
		// 20 paints at distinct T just above 1 → one synthetic anchor (~T=1.019).
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }], command_complete: true }
					}
				})
			);
		}
		const before = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(before).toHaveLength(1);

		// Author a user anchor at an EARLIER T — it changes the base state for
		// projections at/after T=0.5, so the later synthetic anchor (frozen
		// from the old base) must be dropped.
		await CREATE_ANCHOR(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 0.5,
					stateJsonb: { regions: [], artifacts: [], chains: [], cells: [] }
				}
			})
		);
		const after = await currentDb
			.select({ id: mapAnchors.id })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(after).toHaveLength(0);
	});
});

describe('Slice 3 codex P2 follow-ups (iter 3 review — authored anchors)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('#12 authoring a snapshot at a T occupied by a synthetic anchor replaces it (no 409)', async () => {
		const map = await seedMap();
		// 20 paints at T=5 → a synthetic anchor at T=5.
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 5,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }], command_complete: true }
					}
				})
			);
		}
		// An authored snapshot at the same T must succeed — the synthetic cache
		// row is replaced, not collided with.
		const res = await CREATE_ANCHOR(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 5,
					stateJsonb: {
						regions: [],
						artifacts: [],
						chains: [],
						cells: [{ x: 0, y: 0, biome: 'forest' }]
					}
				}
			})
		);
		expect(res.status).toBe(201);
		// Exactly one anchor at T=5, and it is authored (not synthetic).
		const at5 = await currentDb
			.select({ isSynthetic: mapAnchors.isSynthetic })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.tPosition, 5)));
		expect(at5).toHaveLength(1);
		expect(at5[0].isSynthetic).toBe(false);
	});

	it('#14 authored anchor with an out-of-bounds cell is rejected (400)', async () => {
		const map = await seedMap(); // default grid 32×24
		await expect(
			CREATE_ANCHOR(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 3,
						stateJsonb: {
							regions: [],
							artifacts: [],
							chains: [],
							cells: [{ x: 99, y: 0, biome: 'plains' }]
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('#14 authored anchor with an unknown biome is rejected (400)', async () => {
		const map = await seedMap();
		await expect(
			CREATE_ANCHOR(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 3,
						stateJsonb: {
							regions: [],
							artifacts: [],
							chains: [],
							cells: [{ x: 1, y: 1, biome: 'lava' }]
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('#14 authored anchor with valid in-bounds cells is accepted and persists them', async () => {
		const map = await seedMap();
		const res = await CREATE_ANCHOR(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 3,
					stateJsonb: {
						regions: [],
						artifacts: [],
						chains: [],
						cells: [{ x: 2, y: 2, biome: 'water' }]
					}
				}
			})
		);
		expect(res.status).toBe(201);
		const body = (await readJson(res)) as { stateJsonb: { cells: Array<{ x: number }> } };
		expect(body.stateJsonb.cells).toHaveLength(1);
	});
});

describe('Slice 3 codex P2 follow-ups (iter 4 review)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('#16 a retroactive paint below a synthetic anchor is not shadowed (anchor refreshed)', async () => {
		const map = await seedMap();
		// 20 paints at T=10 → synthetic anchor at T=10 (cells x=0..19).
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 10,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }], command_complete: true }
					}
				})
			);
		}
		// A retroactive paint at T=5 (< the synthetic anchor's T). Pre-fix the
		// synthetic@10 snapshot (which excludes events at t<=10) would shadow
		// it. The event-insert invalidation drops the stale anchor; the
		// re-materialized snapshot at maxT=10 folds events through T=10, so the
		// retroactive cell is now part of projected state at/after T=10.
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 5,
					kind: 'paint_cells',
					payloadJsonb: { cells: [{ x: 25, y: 5, biome: 'forest' }], command_complete: true }
				}
			})
		);
		const synthetic = await currentDb
			.select({ stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(and(eq(mapAnchors.worldMapId, map.id), eq(mapAnchors.isSynthetic, true)));
		expect(synthetic).toHaveLength(1);
		const cells = (synthetic[0].stateJsonb as { cells: Array<{ x: number; y: number }> }).cells;
		// The retroactive cell is no longer hidden behind a stale snapshot.
		expect(cells.some((c) => c.x === 25 && c.y === 5)).toBe(true);
	});
});
