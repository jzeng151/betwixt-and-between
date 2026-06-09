/**
 * WM3 Slice C — textured brushes + masks (erase mode + varied scatter).
 *
 * Covers:
 *   ERASE VALIDATION — mode='erase' accepts material-less strokes (no
 *     textureKey) and rejects a textureKey or stamp params (a non-stock
 *     client); erase strokes carry layerId like any stroke (the layer-mask
 *     targeting).
 *   SCATTER FAMILY KEYS — stamp mode accepts a STAMP_GROUP_KEYS family key
 *     ("tree_object"); fill mode does NOT (families are stamp-only); unknown
 *     keys still reject.
 *   FOLD — an erase stroke folds through projectState (mode kept, no
 *     textureKey); a forged erase-with-textureKey row is dropped by the fold's
 *     lazy GC; family-key stamps fold like any stamp.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import {
	projectState,
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

async function seedMap(name = 'M'): Promise<{ id: string }> {
	const res = await CREATE_MAP(mkEvent({ body: { name } }));
	return JSON.parse(await res.text()) as { id: string };
}

const basePath = [
	{ x: 0.1, y: 0.1 },
	{ x: 0.2, y: 0.2 }
];

const eraseStroke = (over: Partial<PaintStrokePayload> = {}): Partial<PaintStrokePayload> => ({
	path: basePath,
	brushSize: 0.05,
	softness: 0.5,
	mode: 'erase',
	...over
});

const emptyCtx: ProjectionContext = {
	allowedFactions: new Map(),
	allowedRegions: new Set()
};

describe('Slice C — erase + scatter validation', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		userId = (await seedTestUser(currentDb)).id;
	});

	const post = async (mapId: string, payload: unknown) =>
		CREATE_EVENT(
			mkEvent({
				params: { id: mapId },
				body: { tPosition: 1, kind: 'paint_stroke', payloadJsonb: payload }
			})
		);

	it('accepts an erase stroke with no textureKey', async () => {
		const map = await seedMap();
		const res = await post(map.id, eraseStroke());
		expect(res.status).toBe(201);
	});

	it('an erase stroke can target an art layer (layer-mask)', async () => {
		const map = await seedMap();
		const layerId = crypto.randomUUID();
		await PATCH_MAP(
			mkEvent({
				params: { id: map.id },
				body: { artLayersJsonb: [{ id: layerId, name: 'Inks', blendMode: 'normal', opacity: 1 }] }
			})
		);
		const res = await post(map.id, eraseStroke({ layerId }));
		expect(res.status).toBe(201);
		const row = JSON.parse(await res.text()) as { payloadJsonb: { layerId?: string } };
		expect(row.payloadJsonb.layerId).toBe(layerId);
	});

	it('rejects an erase stroke carrying a textureKey', async () => {
		const map = await seedMap();
		await expect(post(map.id, eraseStroke({ textureKey: 'Grass' }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('rejects an erase stroke carrying stamp params', async () => {
		const map = await seedMap();
		await expect(
			post(map.id, eraseStroke({ stamp: { spacing: 0.02, jitter: 0 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts a stamp stroke with a FAMILY key (varied scatter)', async () => {
		const map = await seedMap();
		const res = await post(map.id, {
			path: basePath,
			brushSize: 0.05,
			softness: 0,
			mode: 'stamp',
			textureKey: 'tree_object'
		});
		expect(res.status).toBe(201);
	});

	it('rejects a FILL stroke with a family key (families are stamp-only)', async () => {
		const map = await seedMap();
		await expect(
			post(map.id, {
				path: basePath,
				brushSize: 0.05,
				softness: 0,
				mode: 'fill',
				textureKey: 'tree_object'
			})
		).rejects.toMatchObject({ status: 400 });
	});

	it('still rejects an unknown stamp key', async () => {
		const map = await seedMap();
		await expect(
			post(map.id, {
				path: basePath,
				brushSize: 0.05,
				softness: 0,
				mode: 'stamp',
				textureKey: 'zzz_not_real'
			})
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('Slice C — erase + family keys through the fold', () => {
	const strokeEvent = (t: number, payload: unknown): ProjectionEvent => ({
		id: `e-${t}`,
		tPosition: t,
		kind: 'paint_stroke',
		createdAt: '2026-01-01T00:00:01Z',
		payloadJsonb: payload
	});

	it('an erase stroke folds through with mode kept and no textureKey', () => {
		const out = projectState(1, [], [strokeEvent(0.5, eraseStroke())], emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].mode).toBe('erase');
		expect(out.strokes[0].textureKey).toBeUndefined();
	});

	it('a forged erase-with-textureKey row is dropped (lazy GC)', () => {
		const forged = eraseStroke({ textureKey: 'Grass' });
		const out = projectState(1, [], [strokeEvent(0.5, forged)], emptyCtx);
		expect(out.strokes).toHaveLength(0);
	});

	it('a family-key stamp folds like any stamp', () => {
		const out = projectState(
			1,
			[],
			[
				strokeEvent(0.5, {
					path: basePath,
					brushSize: 0.05,
					softness: 0,
					mode: 'stamp',
					textureKey: 'tree_object'
				})
			],
			emptyCtx
		);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].textureKey).toBe('tree_object');
	});

	it('an anchor-baked erase stroke seeds through the same gate', () => {
		const anchor: ProjectionAnchor = {
			id: 'a',
			tPosition: 0,
			createdAt: '2026-01-01T00:00:00Z',
			stateJsonb: {
				regions: [],
				artifacts: [],
				cells: [],
				strokes: [eraseStroke() as StoredStroke]
			}
		};
		const out = projectState(1, [anchor], [], emptyCtx);
		expect(out.strokes).toHaveLength(1);
		expect(out.strokes[0].mode).toBe('erase');
	});
});
