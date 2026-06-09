/**
 * WM3 Slice A — server + projection tests for paint_stroke (freeform brush).
 *
 * Covers (eng-review test surface):
 *   FOLD SEAM — paint_stroke folds in the (anchorT, t] window; a stroke at the
 *     -∞ baseline renders with no anchor; cells + strokes coexist on one map.
 *   ⭐ ANCHOR-BAKE SURVIVAL — the regression for eng-review finding #1: a stroke
 *     must survive an auto-anchor triggered by coexisting paint_cells AND a
 *     manual createMapAnchor at a later T. Pre-fix, projectState excludes events
 *     with t_position <= anchorT and the anchor snapshot carried no strokes, so
 *     the stroke silently vanished the moment any anchor was written above it.
 *   VALIDATION — mode, textureKey (fill vs stamp key sets), brushSize/softness
 *     ranges, path cap/empty/non-finite, stamp params.
 *   UNDO — command_id pops the whole stroke.
 *   AUTO-ANCHOR COUNTING — paint_stroke counts toward K (eng-review §6).
 *
 * Calls handler functions directly with a mock RequestEvent — same shape as
 * world-map-v3-slice-3-paint-cells.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { mapAnchors, mapEvents } from '../../src/lib/server/db/schema.js';
import {
	projectState,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionEvent,
	type PaintStrokePayload,
	type StoredStroke
} from '../../src/lib/features/map/projection.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

const { POST: CREATE_MAP } = await import('../../src/routes/api/maps/+server.js');
const { POST: CREATE_EVENT } = await import('../../src/routes/api/maps/[id]/events/+server.js');
const { POST: UNDO_EVENT } = await import('../../src/routes/api/maps/[id]/events/undo/+server.js');
const { POST: CREATE_ANCHOR } = await import('../../src/routes/api/maps/[id]/anchors/+server.js');

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

const fillStroke = (over: Partial<PaintStrokePayload> = {}): PaintStrokePayload => ({
	path: [
		{ x: 0.1, y: 0.1 },
		{ x: 0.2, y: 0.2 }
	],
	brushSize: 0.05,
	softness: 0.5,
	mode: 'fill',
	textureKey: 'Grass',
	...over
});

// Load DB rows back into the projectState input shapes (non-undone events only).
async function loadProjectionInputs(
	mapId: string
): Promise<{ anchors: ProjectionAnchor[]; events: ProjectionEvent[] }> {
	const anchorRows = await currentDb
		.select({
			id: mapAnchors.id,
			tPosition: mapAnchors.tPosition,
			createdAt: mapAnchors.createdAt,
			stateJsonb: mapAnchors.stateJsonb
		})
		.from(mapAnchors)
		.where(eq(mapAnchors.worldMapId, mapId));
	const eventRows = await currentDb
		.select({
			id: mapEvents.id,
			tPosition: mapEvents.tPosition,
			kind: mapEvents.kind,
			createdAt: mapEvents.createdAt,
			payloadJsonb: mapEvents.payloadJsonb
		})
		.from(mapEvents)
		.where(sql`${mapEvents.worldMapId} = ${mapId} AND ${mapEvents.undoneAt} IS NULL`);
	return {
		anchors: anchorRows as ProjectionAnchor[],
		events: eventRows as ProjectionEvent[]
	};
}

// -- FOLD SEAM ---------------------------------------------------------------

describe('Slice A — paint_stroke fold seam (projection)', () => {
	const baseAnchor = (t: number, strokes: StoredStroke[] = []): ProjectionAnchor => ({
		id: 'anchor',
		tPosition: t,
		createdAt: '2026-01-01T00:00:00Z',
		stateJsonb: { regions: [], artifacts: [], cells: [], strokes }
	});
	const strokeEvent = (t: number, key = 'Grass'): ProjectionEvent => ({
		id: `e-${t}`,
		tPosition: t,
		kind: 'paint_stroke',
		createdAt: '2026-01-01T00:00:01Z',
		payloadJsonb: fillStroke({ textureKey: key })
	});

	it('folds a stroke event in the (anchorT, t] window', () => {
		const out = projectState(1, [baseAnchor(0)], [strokeEvent(0.5)], emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].textureKey).toBe('Grass');
	});

	it('excludes a stroke event at exactly anchor.t (same-T rule)', () => {
		const out = projectState(1, [baseAnchor(0.5)], [strokeEvent(0.5)], emptyCtx);
		expect(out.strokes).toHaveLength(0);
	});

	it('renders a baseline stroke with NO anchor (strokes-only map, -∞ baseline)', () => {
		const out = projectState(1, [], [strokeEvent(0.5)], emptyCtx);
		expect(out.strokes).toHaveLength(1);
	});

	it('appends in painter order: anchor-baked strokes first, then events', () => {
		const baked = fillStroke({ textureKey: 'Sand' });
		const out = projectState(2, [baseAnchor(0, [baked])], [strokeEvent(1, 'Grass')], emptyCtx);
		expect(out.strokes.map((s) => s.textureKey)).toEqual(['Sand', 'Grass']);
	});

	it('drops a malformed baked stroke (lazy GC) on seed', () => {
		const bad = { ...fillStroke(), textureKey: 'not_a_real_key' } as unknown as StoredStroke;
		const out = projectState(2, [baseAnchor(0, [bad])], [], emptyCtx);
		expect(out.strokes).toHaveLength(0);
	});

	it('cells and strokes coexist on one map', () => {
		const anchor: ProjectionAnchor = {
			id: 'a',
			tPosition: 0,
			createdAt: '2026-01-01T00:00:00Z',
			stateJsonb: { regions: [], artifacts: [], cells: [{ x: 1, y: 1, biome: 'plains' }], strokes: [] }
		};
		const out = projectState(2, [anchor], [strokeEvent(1)], emptyCtx);
		expect(out.cells).toHaveLength(1);
		expect(out.strokes).toHaveLength(1);
	});
});

// -- ⭐ ANCHOR-BAKE SURVIVAL (eng-review finding #1) -------------------------

describe('Slice A — ⭐ strokes survive anchor writes (finding #1 regression)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('a stroke survives an auto-anchor triggered by 20 coexisting paint_cells', async () => {
		const map = await seedMap();
		// One freeform stroke at T=1.
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 1, kind: 'paint_stroke', payloadJsonb: fillStroke() }
			})
		);
		// 20 grid paints just above it → auto-anchor fires at maxT.
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1.1 + i * 0.001,
						kind: 'paint_cells',
						payloadJsonb: { cells: [{ x: i, y: 0, biome: 'plains' }] }
					}
				})
			);
		}
		const anchors = await currentDb
			.select({ isSynthetic: mapAnchors.isSynthetic, stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		const synthetic = anchors.filter((a) => a.isSynthetic);
		expect(synthetic).toHaveLength(1);
		// The baked snapshot carries the stroke (server fold) — NOT dropped.
		const snap = synthetic[0].stateJsonb as { strokes?: StoredStroke[] };
		expect(snap.strokes).toHaveLength(1);

		// End-to-end read path: project ABOVE the synthetic anchor's T. The
		// stroke event is now <= anchorT (excluded from the event window), so it
		// can only render if the anchor carried it.
		const { anchors: a, events: e } = await loadProjectionInputs(map.id);
		const out = projectState(5, a, e, emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].textureKey).toBe('Grass');
	});

	it('a stroke survives a manual anchor created at a later T', async () => {
		const map = await seedMap();
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 1, kind: 'paint_stroke', payloadJsonb: fillStroke() }
			})
		);
		// Manual "snapshot world state here" at a later T. The client sends the
		// projected state including the stroke; the server sanitizes + persists it.
		const pre = await loadProjectionInputs(map.id);
		const projected = projectState(1.5, pre.anchors, pre.events, emptyCtx);
		await CREATE_ANCHOR(
			mkEvent({
				params: { id: map.id },
				body: {
					tPosition: 2,
					stateJsonb: { regions: [], artifacts: [], cells: [], strokes: projected.strokes }
				}
			})
		);
		const { anchors, events } = await loadProjectionInputs(map.id);
		const out = projectState(3, anchors, events, emptyCtx);
		expect(out.strokes).toHaveLength(1);
	});
});

// -- AUTO-ANCHOR COUNTING (eng-review §6) ------------------------------------

describe('Slice A — paint_stroke counts toward AUTO_ANCHOR_K', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('20 paint_stroke events fire an auto-anchor that bakes all 20 strokes', async () => {
		const map = await seedMap();
		for (let i = 0; i < 20; i++) {
			await CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1 + i * 0.001,
						kind: 'paint_stroke',
						payloadJsonb: fillStroke()
					}
				})
			);
		}
		const anchors = await currentDb
			.select({ isSynthetic: mapAnchors.isSynthetic, stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id))
			.orderBy(asc(mapAnchors.createdAt));
		const synthetic = anchors.filter((a) => a.isSynthetic);
		expect(synthetic).toHaveLength(1);
		const snap = synthetic[0].stateJsonb as { strokes?: StoredStroke[] };
		expect(snap.strokes).toHaveLength(20);
	});
});

// -- VALIDATION --------------------------------------------------------------

describe('Slice A — paint_stroke server validator', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	async function post(payload: unknown): Promise<Response> {
		const map = await seedMap();
		return CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 1, kind: 'paint_stroke', payloadJsonb: payload }
			})
		);
	}

	it('accepts a happy-path fill stroke', async () => {
		const res = await post(fillStroke());
		expect(res.status).toBe(201);
	});

	it('accepts a happy-path stamp stroke with a real Objects/ key', async () => {
		const res = await post(
			fillStroke({ mode: 'stamp', textureKey: 'tree_object_01', stamp: { spacing: 0.02, jitter: 0.01 } })
		);
		expect(res.status).toBe(201);
	});

	const rejects400 = (payload: unknown) =>
		expect(post(payload)).rejects.toMatchObject({ status: 400 });

	it('rejects an unknown mode', async () => {
		await rejects400(fillStroke({ mode: 'splat' as unknown as 'fill' }));
	});

	it('rejects a fill textureKey that is actually a stamp key', async () => {
		await rejects400(fillStroke({ mode: 'fill', textureKey: 'tree_object_01' }));
	});

	it('rejects a stamp textureKey that is actually a terrain key', async () => {
		await rejects400(fillStroke({ mode: 'stamp', textureKey: 'Grass' }));
	});

	it('rejects an unknown textureKey', async () => {
		await rejects400(fillStroke({ textureKey: 'zzz_not_real' }));
	});

	it('rejects brushSize out of (0,1]', async () => {
		await rejects400(fillStroke({ brushSize: 0 }));
		await rejects400(fillStroke({ brushSize: 1.5 }));
	});

	it('rejects softness out of [0,1]', async () => {
		await rejects400(fillStroke({ softness: -0.1 }));
		await rejects400(fillStroke({ softness: 2 }));
	});

	it('rejects an empty path', async () => {
		await rejects400(fillStroke({ path: [] }));
	});

	it('rejects a path with a non-finite point', async () => {
		await rejects400(fillStroke({ path: [{ x: 0.1, y: Number.POSITIVE_INFINITY }] }));
	});

	it('rejects a path over the point cap', async () => {
		const path = Array.from({ length: 5000 }, (_, i) => ({ x: i / 5000, y: 0.5 }));
		await rejects400(fillStroke({ path }));
	});

	it('rejects malformed stamp params (spacing <= 0)', async () => {
		await rejects400(
			fillStroke({ mode: 'stamp', textureKey: 'tree_object_01', stamp: { spacing: 0, jitter: 0 } })
		);
	});
});

// -- UNDO --------------------------------------------------------------------

describe('Slice A — paint_stroke undo by command_id', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	it('undo soft-deletes the stroke; projection no longer renders it', async () => {
		const map = await seedMap();
		await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 1, kind: 'paint_stroke', payloadJsonb: fillStroke() }
			})
		);
		let { anchors, events } = await loadProjectionInputs(map.id);
		expect(projectState(2, anchors, events, emptyCtx).strokes).toHaveLength(1);

		await UNDO_EVENT(mkEvent({ params: { id: map.id } }));

		({ anchors, events } = await loadProjectionInputs(map.id));
		expect(projectState(2, anchors, events, emptyCtx).strokes).toHaveLength(0);
	});
});
