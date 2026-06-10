/**
 * WM3 security/bug-audit fixes (2026-06-10) — regression tests.
 *
 *   A1 — anchor tPosition must be >= 0 (create + PATCH). Authored negative
 *        t_positions could collide with the act-reorder cascade's parked
 *        anchor rows (ANCHOR_PARK_BASE - i in recompute.ts) and abort the
 *        whole reorder/delete transaction.
 *   A2 — anchor create/PATCH NORMALIZE strokes[].layerId against the map's
 *        art_layers_jsonb, mirroring the render-side F5 orphaned-layer policy
 *        (fill/stamp rebased to base, erase dropped). REVISED 2026-06-10 from
 *        the original "reject unknown layerId with 400": that broke "Snapshot
 *        world state here" for any map with a since-deleted painted layer,
 *        because the snapshot captures exactly the rendered strokes, which
 *        legitimately carry orphaned ids (Codex review #5). The paint_stroke
 *        EVENT validator still rejects unknown layerId — you cannot author a
 *        NEW stroke onto a non-existent layer; only the snapshot path tolerates
 *        orphans, matching what the renderer already draws.
 *   A3 — paint_stroke events reject stamp params on non-stamp modes
 *        (validator/fold lockstep: applyPaintStroke drops them silently).
 *   A4 — maps POST / PATCH go through readJson: a non-object body is a
 *        clean 400, not a destructure TypeError surfacing as 500.
 *
 * Calls handler functions directly with a mock RequestEvent (same shape as
 * the sibling slice tests).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { mkEvent as mkEventCtx, readJson, fillStroke, type TestCtx } from '../helpers/map-test-harness.js';
import { mapAnchors } from '../../src/lib/server/db/schema.js';

const ctx: TestCtx = { db: null as unknown as TestCtx['db'], userId: '' };
const mkEvent = (overrides: { params?: Record<string, string>; body?: unknown } = {}) =>
	mkEventCtx(ctx, overrides);

const { POST: CREATE_MAP } = await import('../../src/routes/api/maps/+server.js');
const { PATCH: PATCH_MAP } = await import('../../src/routes/api/maps/[id]/+server.js');
const { POST: CREATE_EVENT } = await import('../../src/routes/api/maps/[id]/events/+server.js');
const { POST: CREATE_ANCHOR } = await import('../../src/routes/api/maps/[id]/anchors/+server.js');
const { PATCH: PATCH_ANCHOR } = await import(
	'../../src/routes/api/maps/[id]/anchors/[anchorId]/+server.js'
);

async function seedMap(): Promise<{ id: string }> {
	return (await readJson(await CREATE_MAP(mkEvent({ body: { name: 'M' } })))) as { id: string };
}

const emptyState = { regions: [], artifacts: [], chains: [], cells: [], strokes: [] };

beforeEach(async () => {
	ctx.db = await createTestDb();
	ctx.userId = (await seedTestUser(ctx.db)).id;
});

describe('A1 — anchor tPosition must be >= 0', () => {
	it('rejects a negative tPosition on create', async () => {
		const map = await seedMap();
		await expect(
			CREATE_ANCHOR(
				mkEvent({ params: { id: map.id }, body: { tPosition: -1, stateJsonb: emptyState } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a negative tPosition on PATCH', async () => {
		const map = await seedMap();
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({ params: { id: map.id }, body: { tPosition: 1, stateJsonb: emptyState } })
			)
		)) as { id: string };
		await expect(
			PATCH_ANCHOR(
				mkEvent({ params: { id: map.id, anchorId: created.id }, body: { tPosition: -0.5 } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts tPosition exactly 0', async () => {
		const map = await seedMap();
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({ params: { id: map.id }, body: { tPosition: 0, stateJsonb: emptyState } })
			)
		)) as { tPosition: number };
		expect(created.tPosition).toBe(0);
	});
});

describe('A2 — anchor strokes[].layerId normalized against the map (F5 parity)', () => {
	const layer = { id: 'layer-1', name: 'L1', blendMode: 'normal', opacity: 1 };
	const strokesOf = (row: { stateJsonb: unknown }) =>
		(row.stateJsonb as { strokes: Array<{ layerId?: string; mode: string }> }).strokes;
	const loadAnchor = async (id: string) =>
		(
			await ctx.db.select({ stateJsonb: mapAnchors.stateJsonb }).from(mapAnchors).where(eq(mapAnchors.id, id))
		)[0];

	it('rebases an orphaned-layer fill stroke to base on create (no 400)', async () => {
		const map = await seedMap();
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						stateJsonb: { ...emptyState, strokes: [fillStroke({ layerId: 'no-such-layer' })] }
					}
				})
			)
		)) as { id: string };
		const strokes = strokesOf(await loadAnchor(created.id));
		expect(strokes).toHaveLength(1);
		expect(strokes[0].layerId).toBeUndefined(); // rebased to base, not rejected
	});

	it('drops an orphaned-layer erase stroke on create', async () => {
		const map = await seedMap();
		const eraseOrphan = {
			path: [
				{ x: 0.1, y: 0.1 },
				{ x: 0.3, y: 0.3 }
			],
			brushSize: 0.05,
			softness: 0,
			mode: 'erase' as const,
			layerId: 'no-such-layer'
		};
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({
					params: { id: map.id },
					body: { tPosition: 1, stateJsonb: { ...emptyState, strokes: [eraseOrphan] } }
				})
			)
		)) as { id: string };
		expect(strokesOf(await loadAnchor(created.id))).toHaveLength(0); // dropped, no base-eating
	});

	it('rebases an orphaned-layer fill stroke to base on PATCH', async () => {
		const map = await seedMap();
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({ params: { id: map.id }, body: { tPosition: 1, stateJsonb: emptyState } })
			)
		)) as { id: string };
		await PATCH_ANCHOR(
			mkEvent({
				params: { id: map.id, anchorId: created.id },
				body: { stateJsonb: { ...emptyState, strokes: [fillStroke({ layerId: 'no-such-layer' })] } }
			})
		);
		const strokes = strokesOf(await loadAnchor(created.id));
		expect(strokes).toHaveLength(1);
		expect(strokes[0].layerId).toBeUndefined();
	});

	it('accepts and persists a stroke referencing an existing art layer', async () => {
		const map = await seedMap();
		await PATCH_MAP(mkEvent({ params: { id: map.id }, body: { artLayersJsonb: [layer] } }));
		const created = (await readJson(
			await CREATE_ANCHOR(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						stateJsonb: { ...emptyState, strokes: [fillStroke({ layerId: layer.id })] }
					}
				})
			)
		)) as { id: string };
		const [row] = await ctx.db
			.select({ stateJsonb: mapAnchors.stateJsonb })
			.from(mapAnchors)
			.where(eq(mapAnchors.id, created.id));
		const strokes = (row.stateJsonb as { strokes: Array<{ layerId?: string }> }).strokes;
		expect(strokes).toHaveLength(1);
		expect(strokes[0].layerId).toBe(layer.id);
	});
});

describe('A3 — stamp params rejected on non-stamp strokes', () => {
	it('rejects stamp params on a fill paint_stroke event', async () => {
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: {
						tPosition: 1,
						kind: 'paint_stroke',
						payloadJsonb: fillStroke({ stamp: { spacing: 0.1, jitter: 0.2 } })
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('A4 — maps POST/PATCH reject non-object bodies with 400', () => {
	it('POST /api/maps with a null body is a 400', async () => {
		await expect(CREATE_MAP(mkEvent({ body: null }))).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH /api/maps/[id] with an array body is a 400', async () => {
		const map = await seedMap();
		await expect(
			PATCH_MAP(mkEvent({ params: { id: map.id }, body: [] }))
		).rejects.toMatchObject({ status: 400 });
	});
});

// Codex adversarial review (2026-06-10) follow-ups, surfaced on this branch.
describe('C3 — event tPosition must be >= 0', () => {
	it('rejects a negative tPosition on a paint_stroke event', async () => {
		// A1 added the >= 0 guard to anchors but not to events; a negative event
		// t becomes a synthetic anchor t_position that can collide with the
		// act-reorder parking sentinel (ANCHOR_PARK_BASE = -1_000_000).
		const map = await seedMap();
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: { tPosition: -1_000_000, kind: 'paint_stroke', payloadJsonb: fillStroke() }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts tPosition exactly 0 on a paint_stroke event', async () => {
		const map = await seedMap();
		const res = await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 0, kind: 'paint_stroke', payloadJsonb: fillStroke() }
			})
		);
		expect((res as Response).status).toBe(201);
	});
});

describe('C4 — paint_stroke at an authored anchor T is rejected, not silently lost', () => {
	it('rejects a paint_stroke whose tPosition equals an authored anchor', async () => {
		// Same-T rule (CMT-5) excludes events at anchorT and auto-anchor won't
		// overwrite an authored anchor, so such a stroke would persist invisibly.
		const map = await seedMap();
		await CREATE_ANCHOR(
			mkEvent({ params: { id: map.id }, body: { tPosition: 2, stateJsonb: emptyState } })
		);
		await expect(
			CREATE_EVENT(
				mkEvent({
					params: { id: map.id },
					body: { tPosition: 2, kind: 'paint_stroke', payloadJsonb: fillStroke() }
				})
			)
		).rejects.toMatchObject({ status: 409 });
	});

	it('allows a paint_stroke at a T with no authored anchor', async () => {
		const map = await seedMap();
		await CREATE_ANCHOR(
			mkEvent({ params: { id: map.id }, body: { tPosition: 2, stateJsonb: emptyState } })
		);
		const res = await CREATE_EVENT(
			mkEvent({
				params: { id: map.id },
				body: { tPosition: 3, kind: 'paint_stroke', payloadJsonb: fillStroke() }
			})
		);
		expect((res as Response).status).toBe(201);
	});
});
