/**
 * WM3 freeform-brush /review fixes — regression tests for the validation /
 * persistence behaviors hardened in response to docs/findings/*review*.
 *
 *   F10 — PATCH /maps/[id] artLayersJsonb persists ONLY the known fields
 *         (extra keys stripped, not stored verbatim).
 *   F21 — art layer id (and paint_stroke layerId) capped at ART_LAYER_ID_MAX
 *         so `art:<id>` fits the 64-char pref key.
 *   F18 — validateAnchorStateShape caps strokes count, total points, and
 *         rejects a non-array strokes value.
 *   F19 — PATCH anchor omitting strokes wipes baked strokes to [] (the
 *         load-bearing normalization the review flagged).
 *
 * Calls handler functions directly with a mock RequestEvent (same shape as the
 * sibling slice tests).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { mkEvent as mkEventCtx, readJson, type TestCtx } from '../helpers/map-test-harness.js';
import { mapAnchors } from '../../src/lib/server/db/schema.js';
import { ART_LAYER_ID_MAX } from '../../src/lib/features/map/projection.js';

const ctx: TestCtx = { db: null as unknown as TestCtx['db'], userId: '' };
const mkEvent = (overrides: { params?: Record<string, string>; body?: unknown } = {}) =>
	mkEventCtx(ctx, overrides);

const { POST: CREATE_MAP } = await import('../../src/routes/api/maps/+server.js');
const { PATCH: PATCH_MAP, GET: GET_MAP } = await import('../../src/routes/api/maps/[id]/+server.js');
const { POST: CREATE_EVENT } = await import('../../src/routes/api/maps/[id]/events/+server.js');
const { POST: CREATE_ANCHOR } = await import('../../src/routes/api/maps/[id]/anchors/+server.js');
const { PATCH: PATCH_ANCHOR } = await import(
	'../../src/routes/api/maps/[id]/anchors/[anchorId]/+server.js'
);

async function seedMap(): Promise<{ id: string }> {
	return (await readJson(await CREATE_MAP(mkEvent({ body: { name: 'M' } })))) as { id: string };
}

beforeEach(async () => {
	ctx.db = await createTestDb();
	ctx.userId = (await seedTestUser(ctx.db)).id;
});

describe('F10 — artLayersJsonb persists only known fields', () => {
	it('strips extra keys on PATCH', async () => {
		const map = await seedMap();
		await PATCH_MAP(
			mkEvent({
				params: { id: map.id },
				body: {
					artLayersJsonb: [
						{
							id: 'layer-1',
							name: 'L1',
							blendMode: 'normal',
							opacity: 1,
							junk: 'x'.repeat(1000),
							nested: { a: 1 }
						}
					]
				}
			})
		);
		const got = (await readJson(await GET_MAP(mkEvent({ params: { id: map.id } })))) as {
			artLayersJsonb: Array<Record<string, unknown>>;
		};
		expect(got.artLayersJsonb).toHaveLength(1);
		expect(Object.keys(got.artLayersJsonb[0]).sort()).toEqual([
			'blendMode',
			'id',
			'name',
			'opacity'
		]);
		expect(got.artLayersJsonb[0].junk).toBeUndefined();
	});
});

describe('F21 — layer id capped to fit the pref key', () => {
	it('rejects an art layer id over the cap', async () => {
		const map = await seedMap();
		const tooLong = 'a'.repeat(ART_LAYER_ID_MAX + 1);
		await expect(
			PATCH_MAP(
				mkEvent({
					params: { id: map.id },
					body: {
						artLayersJsonb: [{ id: tooLong, name: 'L', blendMode: 'normal', opacity: 1 }]
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a paint_stroke layerId over the cap', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_stroke',
						payloadJsonb: {
							path: [{ x: 0.1, y: 0.1 }],
							brushSize: 0.05,
							softness: 0.5,
							mode: 'fill',
							textureKey: 'Grass',
							layerId: 'a'.repeat(ART_LAYER_ID_MAX + 1)
						}
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('F18 — anchor strokes shape + size caps', () => {
	const anchorBody = (strokes: unknown) => ({
		tPosition: 1,
		stateJsonb: { regions: [], artifacts: [], chains: [], cells: [], strokes }
	});

	it('rejects a non-array strokes', async () => {
		const map = await seedMap();
		await expect(
			CREATE_ANCHOR(mkEvent({ params: { id: map.id }, body: anchorBody({ not: 'array' }) }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects more than the stroke-count cap', async () => {
		const map = await seedMap();
		const strokes = Array.from({ length: 4097 }, () => ({ path: [{ x: 0, y: 0 }] }));
		await expect(
			CREATE_ANCHOR(mkEvent({ params: { id: map.id }, body: anchorBody(strokes) }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects more than the aggregate total-points cap', async () => {
		const map = await seedMap();
		// 17 strokes × 4000 points = 68000 > ANCHOR_MAX_TOTAL_POINTS (65536),
		// under the 4096 stroke-count cap so only the points budget can reject it.
		const strokes = Array.from({ length: 17 }, () => ({
			path: Array.from({ length: 4000 }, () => ({ x: 0, y: 0 }))
		}));
		await expect(
			CREATE_ANCHOR(mkEvent({ params: { id: map.id }, body: anchorBody(strokes) }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('F19 — PATCH anchor omitting strokes wipes baked strokes', () => {
	it('a stateJsonb PATCH with no strokes key resets strokes to []', async () => {
		const map = await seedMap();
		const stroke = {
			path: [
				{ x: 0.1, y: 0.1 },
				{ x: 0.2, y: 0.2 }
			],
			brushSize: 0.05,
			softness: 0.5,
			mode: 'fill',
			textureKey: 'Grass'
		};
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						stateJsonb: { regions: [], artifacts: [], chains: [], cells: [], strokes: [stroke] }
					}
				})
			)
		)) as { id: string };

		// PATCH stateJsonb WITHOUT a strokes key.
		await PATCH_ANCHOR(
			mkEvent({
				params: { id: map.id, anchorId: created.id },
				body: { stateJsonb: { regions: [], artifacts: [], chains: [], cells: [] } }
			})
		);

		const [row] = await ctx.db
			.select({ stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(eq(mapAnchors.id, created.id));
		expect((row.stateJsonb as { strokes?: unknown[] }).strokes).toEqual([]);
	});
});
