/**
 * WM3 Slice B — layered canvas (art layers + paint_stroke.layerId).
 *
 * Covers:
 *   PATCH GATE — world_maps.art_layers_jsonb accepts a valid ordered layer
 *     array and rejects malformed shapes (non-array, over-cap, duplicate ids,
 *     unknown blendMode, opacity out of range, bad name) — jsonb carries no
 *     CHECK, so artLayersValidationError at the PATCH handler is the ONLY gate.
 *   STROKE TARGETING — paint_stroke.layerId must reference an entry of THIS
 *     map's art_layers_jsonb: valid id → 201 (payload persists it), unknown id
 *     → 400, a DIFFERENT map's layer id → 400 (cross-map reference never
 *     reaches the DB), malformed → 400, absent → 201 (base layer).
 *   FOLD PASSTHROUGH — layerId survives the projection fold and the anchor
 *     bake; a malformed stored layerId strips to base (stroke still renders)
 *     rather than dropping the art.
 *
 * Calls handler functions directly with a mock RequestEvent — same shape as
 * world-map-v3-slice-a-paint-stroke.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import {
	projectState,
	MAX_ART_LAYERS,
	type MapArtLayer,
	type PaintStrokePayload,
	type ProjectionAnchor,
	type ProjectionContext,
	type ProjectionEvent,
	type StoredStroke
} from '../../src/lib/features/map/projection.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

const { POST: CREATE_MAP } = await import('../../src/routes/api/maps/+server.js');
const { PATCH: PATCH_MAP } = await import('../../src/routes/api/maps/[id]/+server.js');
const { POST: CREATE_EVENT } = await import('../../src/routes/api/maps/[id]/events/+server.js');

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

const layer = (over: Partial<MapArtLayer> = {}): MapArtLayer => ({
	id: crypto.randomUUID(),
	name: 'Layer 1',
	blendMode: 'normal',
	opacity: 1,
	...over
});

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

const emptyCtx: ProjectionContext = {
	allowedFactions: new Map(),
	allowedRegions: new Set()
};

// -- PATCH GATE ---------------------------------------------------------------

describe('Slice B — art_layers_jsonb PATCH gate', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	const patch = async (mapId: string, artLayersJsonb: unknown) =>
		PATCH_MAP(mkEvent({ params: { id: mapId }, body: { artLayersJsonb } }));

	const rejects400 = (mapId: string, value: unknown) =>
		expect(patch(mapId, value)).rejects.toMatchObject({ status: 400 });

	it('accepts a valid ordered layer array and persists it', async () => {
		const map = await seedMap();
		const layers = [
			layer({ name: 'Underpaint', blendMode: 'multiply', opacity: 0.6 }),
			layer({ name: 'Detail', blendMode: 'normal', opacity: 1 })
		];
		const res = await patch(map.id, layers);
		expect(res.status).toBe(200);
		const updated = (await readJson(res)) as { artLayersJsonb: MapArtLayer[] };
		expect(updated.artLayersJsonb).toEqual(layers);
	});

	it('accepts clearing back to [] (strokes fall back to base at render)', async () => {
		const map = await seedMap();
		await patch(map.id, [layer()]);
		const res = await patch(map.id, []);
		expect(((await readJson(res)) as { artLayersJsonb: unknown[] }).artLayersJsonb).toEqual([]);
	});

	it('rejects a non-array value', async () => {
		const map = await seedMap();
		await rejects400(map.id, { not: 'an array' });
	});

	it('rejects more than MAX_ART_LAYERS entries', async () => {
		const map = await seedMap();
		await rejects400(
			map.id,
			Array.from({ length: MAX_ART_LAYERS + 1 }, (_, i) => layer({ name: `L${i}` }))
		);
	});

	it('rejects duplicate layer ids', async () => {
		const map = await seedMap();
		const dup = layer();
		await rejects400(map.id, [dup, { ...layer(), id: dup.id }]);
	});

	it('rejects an unknown blendMode', async () => {
		const map = await seedMap();
		await rejects400(map.id, [layer({ blendMode: 'overlay' as MapArtLayer['blendMode'] })]);
	});

	it('rejects opacity outside [0, 1]', async () => {
		const map = await seedMap();
		await rejects400(map.id, [layer({ opacity: 1.5 })]);
		await rejects400(map.id, [layer({ opacity: -0.1 })]);
	});

	it('rejects an empty or over-long name', async () => {
		const map = await seedMap();
		await rejects400(map.id, [layer({ name: '' })]);
		await rejects400(map.id, [layer({ name: 'x'.repeat(65) })]);
	});
});

// -- STROKE TARGETING ----------------------------------------------------------

describe('Slice B — paint_stroke.layerId validation', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	async function seedMapWithLayer(): Promise<{ mapId: string; layerId: string }> {
		const map = await seedMap();
		const l = layer({ name: 'Inks' });
		await PATCH_MAP(mkEvent({ params: { id: map.id }, body: { artLayersJsonb: [l] } }));
		return { mapId: map.id, layerId: l.id };
	}

	const post = (mapId: string, payload: unknown) =>
		CREATE_EVENT(
			mkEvent({
				params: { id: mapId },
				body: { tPosition: 1, kind: 'paint_stroke', payloadJsonb: payload }
			})
		);

	it('accepts a stroke targeting an existing layer and persists layerId', async () => {
		const { mapId, layerId } = await seedMapWithLayer();
		const res = await post(mapId, fillStroke({ layerId }));
		expect(res.status).toBe(201);
		const row = (await readJson(res)) as { payloadJsonb: { layerId?: string } };
		expect(row.payloadJsonb.layerId).toBe(layerId);
	});

	it('accepts a stroke with no layerId (base layer)', async () => {
		const { mapId } = await seedMapWithLayer();
		const res = await post(mapId, fillStroke());
		expect(res.status).toBe(201);
	});

	it('rejects an unknown layerId', async () => {
		const { mapId } = await seedMapWithLayer();
		await expect(post(mapId, fillStroke({ layerId: crypto.randomUUID() }))).rejects.toMatchObject({
			status: 400
		});
	});

	it("rejects a DIFFERENT map's layer id (cross-map reference)", async () => {
		const { layerId: foreignLayerId } = await seedMapWithLayer();
		const otherMap = await seedMap('Other');
		await expect(
			post(otherMap.id, fillStroke({ layerId: foreignLayerId }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a malformed layerId', async () => {
		const { mapId } = await seedMapWithLayer();
		await expect(
			post(mapId, fillStroke({ layerId: 123 as unknown as string }))
		).rejects.toMatchObject({ status: 400 });
		await expect(post(mapId, fillStroke({ layerId: '' }))).rejects.toMatchObject({ status: 400 });
	});
});

// -- FOLD PASSTHROUGH ----------------------------------------------------------

describe('Slice B — layerId through the fold and the anchor bake', () => {
	const baseAnchor = (t: number, strokes: StoredStroke[] = []): ProjectionAnchor => ({
		id: 'anchor',
		tPosition: t,
		createdAt: '2026-01-01T00:00:00Z',
		stateJsonb: { regions: [], artifacts: [], cells: [], strokes }
	});
	const strokeEvent = (t: number, payload: PaintStrokePayload): ProjectionEvent => ({
		id: `e-${t}`,
		tPosition: t,
		kind: 'paint_stroke',
		createdAt: '2026-01-01T00:00:01Z',
		payloadJsonb: payload
	});

	it('a stroke event keeps its layerId through projectState', () => {
		const out = projectState(1, [], [strokeEvent(0.5, fillStroke({ layerId: 'lyr-1' }))], emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].layerId).toBe('lyr-1');
	});

	it('an anchor-baked stroke keeps its layerId on seed', () => {
		const baked = { ...fillStroke(), layerId: 'lyr-2' };
		const out = projectState(2, [baseAnchor(0, [baked])], [], emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].layerId).toBe('lyr-2');
	});

	it('a malformed stored layerId strips to base instead of dropping the stroke', () => {
		const bad = { ...fillStroke(), layerId: 123 } as unknown as StoredStroke;
		const out = projectState(2, [baseAnchor(0, [bad])], [], emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].layerId).toBeUndefined();
	});
});
