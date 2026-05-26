/**
 * Vitest integration tests for /api/maps handlers.
 *
 * Calls SvelteKit handler functions directly with mock RequestEvent objects.
 * The `$lib/server/db/index.js` module is mocked with an in-process PGlite instance.
 * SvelteKit error() throws HttpError — use rejects.toMatchObject to assert status.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { and, eq } from 'drizzle-orm';
import { entities, relationships, mapAnchors, mapEvents, factions, worldMaps } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

// vi.mock removed — routes now read event.locals.db (T8b S5' A1)

const { GET: LIST_MAPS, POST: CREATE_MAP } = await import(
	'../../src/routes/api/maps/+server.js'
);
const mapIdRoute = await import('../../src/routes/api/maps/[id]/+server.js');
const { POST: CREATE_REGION } = await import(
	'../../src/routes/api/maps/[id]/regions/+server.js'
);
const regionIdRoute = await import(
	'../../src/routes/api/maps/[id]/regions/[rid]/+server.js'
);
const uploadImageRoute = await import(
	'../../src/routes/api/maps/[id]/upload-image/+server.js'
);
const { POST: DUPLICATE_MAP } = await import(
	'../../src/routes/api/maps/[id]/duplicate/+server.js'
);
const { GET: LIST_EVENTS } = await import(
	'../../src/routes/api/maps/[id]/events/+server.js'
);
const { GET: LIST_ANCHORS } = await import(
	'../../src/routes/api/maps/[id]/anchors/+server.js'
);
const { GET: LIST_FACTIONS, POST: CREATE_FACTION } = await import(
	'../../src/routes/api/factions/+server.js'
);
const factionIdRoute = await import('../../src/routes/api/factions/[id]/+server.js');

function mkEvent(
	overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}
): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/maps'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		},
		locals: {
			db: currentDb,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true },
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 'test-token' },
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

function mkFormDataEvent(
	overrides: { params?: Record<string, string>; file?: File } = {}
): any {
	const formData = new FormData();
	if (overrides.file) formData.append('file', overrides.file);
	return {
		url: new URL('http://localhost/api/maps'),
		params: overrides.params ?? {},
		request: {
			formData: async () => formData
		},
		locals: {
			db: currentDb,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true },
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 'test-token' }
		}
	};
}

describe('/api/maps GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('returns empty array when no maps', async () => {
		const res = await LIST_MAPS(mkEvent());
		const body = await readJson(res);
		expect(body).toEqual([]);
	});

	it('returns maps ordered by createdAt desc', async () => {
		await CREATE_MAP(mkEvent({ body: { name: 'Overworld' } }));
		await CREATE_MAP(mkEvent({ body: { name: 'Dungeon' } }));
		const res = await LIST_MAPS(mkEvent());
		const body = await readJson(res);
		expect(body).toHaveLength(2);
		expect(body[0].name).toBe('Dungeon');
	});
});

describe('/api/maps POST', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('creates a map with valid name', async () => {
		const res = await CREATE_MAP(mkEvent({ body: { name: 'Overworld' } }));
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.name).toBe('Overworld');
		expect(body.id).toBeTruthy();
		expect(body.baseImageUrl).toBeNull();
	});

	it('trims whitespace from name', async () => {
		const res = await CREATE_MAP(mkEvent({ body: { name: '  My Map  ' } }));
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.name).toBe('My Map');
	});

	it('rejects missing name', async () => {
		await expect(CREATE_MAP(mkEvent({ body: {} }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('rejects empty name', async () => {
		await expect(
			CREATE_MAP(mkEvent({ body: { name: '   ' } }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('/api/maps/[id]', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('GET returns map with empty regions', async () => {
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Test' } }))
		);
		const res = await mapIdRoute.GET(
			mkEvent({ params: { id: created.id } })
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.name).toBe('Test');
		expect(body.regions).toEqual([]);
	});

	it('GET returns 404 for missing id', async () => {
		await expect(
			mapIdRoute.GET(
				mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' } })
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('PATCH updates map name', async () => {
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Old' } }))
		);
		const res = await mapIdRoute.PATCH(
			mkEvent({ params: { id: created.id }, body: { name: 'New' } })
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.name).toBe('New');
	});

	it('PATCH updates bitmap fields', async () => {
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Map' } }))
		);
		const res = await mapIdRoute.PATCH(
			mkEvent({
				params: { id: created.id },
				body: { baseImageUrl: '/maps/test.png', width: 1024, height: 768 }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.baseImageUrl).toBe('/maps/test.png');
		expect(body.width).toBe(1024);
		expect(body.height).toBe(768);
	});

	it('PATCH returns 404 for missing id', async () => {
		await expect(
			mapIdRoute.PATCH(
				mkEvent({
					params: { id: '00000000-0000-0000-0000-000000000000' },
					body: { name: 'X' }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('PATCH returns 400 with no valid fields', async () => {
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Map' } }))
		);
		await expect(
			mapIdRoute.PATCH(
				mkEvent({ params: { id: created.id }, body: {} })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('DELETE removes map', async () => {
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Bye' } }))
		);
		const res = await mapIdRoute.DELETE(
			mkEvent({ params: { id: created.id } })
		);
		expect(res.status).toBe(204);
		// Verify gone
		await expect(
			mapIdRoute.GET(mkEvent({ params: { id: created.id } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('DELETE returns 404 for missing id', async () => {
		await expect(
			mapIdRoute.DELETE(
				mkEvent({ params: { id: '00000000-0000-0000-0000-000000000000' } })
			)
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('/api/maps/[id]/regions', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('POST creates a region with valid polygon', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const polygon = [
			[0, 0],
			[100, 0],
			[100, 100],
			[0, 100]
		];
		const res = await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: { polygon }
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.polygon).toEqual(polygon);
		// Slice 2 D1: color field removed from map_regions.
		expect(body.mapId).toBe(map.id);
		expect(body.locationId).toBeNull();
	});

	it('POST rejects polygon with < 3 vertices', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		await expect(
			CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon: [[0, 0], [1, 1]] }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST rejects self-intersecting polygon', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		// Figure-8: crosses in the middle
		const polygon = [
			[0, 0],
			[100, 100],
			[100, 0],
			[0, 100]
		];
		await expect(
			CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST returns 404 for missing map', async () => {
		await expect(
			CREATE_REGION(
				mkEvent({
					params: { id: '00000000-0000-0000-0000-000000000000' },
					body: { polygon: [[0, 0], [1, 0], [1, 1]] }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('GET map returns regions alongside map data', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const polygon = [[0, 0], [50, 0], [50, 50], [0, 50]];
		await CREATE_REGION(
			mkEvent({ params: { id: map.id }, body: { polygon } })
		);
		const res = await mapIdRoute.GET(
			mkEvent({ params: { id: map.id } })
		);
		const body = await readJson(res);
		expect(body.regions).toHaveLength(1);
		expect(body.regions[0].polygon).toEqual(polygon);
	});
});

describe('/api/maps/[id]/regions/[rid]', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	async function setupMapWithRegion() {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const polygon = [[0, 0], [100, 0], [100, 100], [0, 100]];
		const region = await readJson(
			await CREATE_REGION(
				mkEvent({ params: { id: map.id }, body: { polygon } })
			)
		);
		return { map, region };
	}

	// Slice 2 D1: color removed from map_regions; PATCH color is no longer
	// a supported operation. Test deleted intentionally — the field is gone,
	// not just renamed. Visual color now derives from faction_id.

	it('PATCH updates polygon', async () => {
		const { map, region } = await setupMapWithRegion();
		const newPolygon = [[10, 10], [90, 10], [90, 90], [10, 90]];
		const res = await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { polygon: newPolygon }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.polygon).toEqual(newPolygon);
	});

	it('PATCH rejects self-intersecting polygon update', async () => {
		const { map, region } = await setupMapWithRegion();
		await expect(
			regionIdRoute.PATCH(
				mkEvent({
					params: { id: map.id, rid: region.id },
					body: { polygon: [[0, 0], [100, 100], [100, 0], [0, 100]] }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH returns 404 for missing region', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		await expect(
			regionIdRoute.PATCH(
				mkEvent({
					params: {
						id: map.id,
						rid: '00000000-0000-0000-0000-000000000000'
					},
					body: { locationId: null }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('DELETE removes region', async () => {
		const { map, region } = await setupMapWithRegion();
		const res = await regionIdRoute.DELETE(
			mkEvent({ params: { id: map.id, rid: region.id } })
		);
		expect(res.status).toBe(204);
		// Verify gone from map GET
		const mapRes = await mapIdRoute.GET(
			mkEvent({ params: { id: map.id } })
		);
		const mapBody = await readJson(mapRes);
		expect(mapBody.regions).toHaveLength(0);
	});

	it('PATCH sets locationId to null', async () => {
		const { map, region } = await setupMapWithRegion();
		// First set a locationId via PATCH
		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Forest' })
			.returning();
		await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { locationId: loc.id }
			})
		);
		// Now set it to null
		const res = await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { locationId: null }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.locationId).toBeNull();
	});

	// Slice 2 D1: color column removed. Test below kept disabled as a
	// historical marker; restore as a faction_id test if useful.
	it.skip('PATCH sets color to null (obsolete: color removed in Slice 2 D1)', async () => {
		const { map, region } = await setupMapWithRegion();
		// First set a color
		await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { color: '#ff0000' }
			})
		);
		// Now set it to null
		const res = await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { color: null }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.color).toBeNull();
	});

	it('PATCH returns 400 with no valid fields', async () => {
		const { map, region } = await setupMapWithRegion();
		await expect(
			regionIdRoute.PATCH(
				mkEvent({
					params: { id: map.id, rid: region.id },
					body: {}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST creates region with locationId', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Castle' })
			.returning();
		const polygon = [[0, 0], [100, 0], [100, 100]];
		const res = await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: { polygon, locationId: loc.id }
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.locationId).toBe(loc.id);
		expect(body.mapId).toBe(map.id);
	});
});

describe('Map + Region cascade', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('deleting map cascades to regions', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: { polygon: [[0, 0], [50, 0], [50, 50]] }
			})
		);
		await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: { polygon: [[10, 10], [60, 10], [60, 60]] }
			})
		);

		// Verify 2 regions
		let mapRes = await mapIdRoute.GET(mkEvent({ params: { id: map.id } }));
		expect((await readJson(mapRes)).regions).toHaveLength(2);

		// Delete map
		await mapIdRoute.DELETE(mkEvent({ params: { id: map.id } }));

		// Create new map, verify no regions leaked
		const map2 = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M2' } }))
		);
		mapRes = await mapIdRoute.GET(mkEvent({ params: { id: map2.id } }));
		expect((await readJson(mapRes)).regions).toHaveLength(0);
	});
});

describe('/api/maps/[id]/upload-image', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	// Minimal 1x1 white PNG (67 bytes)
	const pngBuffer = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
		'base64'
	);

	it('upload-image returns 404 for missing map', async () => {
		const file = new File([pngBuffer], 'test.png', { type: 'image/png' });
		await expect(
			uploadImageRoute.POST(
				mkFormDataEvent({
					params: { id: '00000000-0000-0000-0000-000000000000' },
					file
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('upload-image returns 400 for no file', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		await expect(
			uploadImageRoute.POST(
				mkFormDataEvent({ params: { id: map.id } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('upload-image returns 400 for unsupported MIME type', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const file = new File([pngBuffer], 'test.txt', { type: 'text/plain' });
		await expect(
			uploadImageRoute.POST(
				mkFormDataEvent({ params: { id: map.id }, file })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('upload-image rejects file > 5 MB', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const bigBuffer = new Uint8Array(6 * 1024 * 1024);
		const file = new File([bigBuffer], 'big.png', { type: 'image/png' });
		await expect(
			uploadImageRoute.POST(
				mkFormDataEvent({ params: { id: map.id }, file })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('upload-image rejects invalid file extension', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const file = new File([pngBuffer], 'test.html', { type: 'image/png' });
		await expect(
			uploadImageRoute.POST(
				mkFormDataEvent({ params: { id: map.id }, file })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('Step 1: POST creates map linked to a Location', async () => {
		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const res = await CREATE_MAP(
			mkEvent({ body: { name: 'Gondor map', locationId: loc.id } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.locationId).toBe(loc.id);
	});

	it('Step 1: POST rejects locationId pointing at a non-Location entity', async () => {
		const [char] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Frodo' })
			.returning();
		await expect(
			CREATE_MAP(mkEvent({ body: { name: 'Bad', locationId: char.id } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('Step 1: PATCH links and unlinks locationId', async () => {
		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Rivendell' })
			.returning();
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Map' } }))
		);
		expect(created.locationId).toBeNull();
		expect(created.locationInactiveAt).toBeNull();

		const linked = await readJson(
			await mapIdRoute.PATCH(
				mkEvent({ params: { id: created.id }, body: { locationId: loc.id } })
			)
		);
		expect(linked.locationId).toBe(loc.id);
		expect(linked.locationInactiveAt).toBeNull();

		const unlinked = await readJson(
			await mapIdRoute.PATCH(
				mkEvent({ params: { id: created.id }, body: { locationId: null } })
			)
		);
		expect(unlinked.locationId).toBeNull();
		expect(unlinked.locationInactiveAt).not.toBeNull();
	});

	it('Step 1: PATCH rejects re-link to a non-Location entity', async () => {
		const [char] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Sam' })
			.returning();
		const created = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Map' } }))
		);
		await expect(
			mapIdRoute.PATCH(
				mkEvent({ params: { id: created.id }, body: { locationId: char.id } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('upload-image succeeds with valid PNG', async () => {
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'M' } }))
		);
		const file = new File([pngBuffer], 'test.png', { type: 'image/png' });
		const res = await uploadImageRoute.POST(
			mkFormDataEvent({ params: { id: map.id }, file })
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.baseImageUrl).toMatch(/^\/api\/maps\/file\//);
		expect(body.width).toBe(1);
		expect(body.height).toBe(1);
	});
});

// Regression: linking a region to a Location must materialize a part_of edge
// from that Location to the map's anchor Location, and removing/unlinking the
// region must drop the edge once it's no longer implied by any polygon.
describe('region → implied part_of edge', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	async function partOfRow(fromId: string, toId: string) {
		const rows = await currentDb
			.select()
			.from(relationships)
			.where(
				and(
					eq(relationships.userId, userId),
					eq(relationships.fromId, fromId),
					eq(relationships.toId, toId),
					eq(relationships.type, 'part_of')
				)
			);
		return rows[0] ?? null;
	}

	const polygon = [
		[0, 0],
		[100, 0],
		[100, 100],
		[0, 100]
	];

	it('POST region with locationId upserts part_of(L, P)', async () => {
		const [parent] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const [child] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Minas Tirith' })
			.returning();
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Gondor map', locationId: parent.id } }))
		);

		await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: { polygon, locationId: child.id }
			})
		);

		const edge = await partOfRow(child.id, parent.id);
		expect(edge).not.toBeNull();
	});

	it('DELETE region drops part_of(L, P) when it was the last polygon for L', async () => {
		const [parent] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const [child] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Minas Tirith' })
			.returning();
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Gondor map', locationId: parent.id } }))
		);
		const region = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon, locationId: child.id }
				})
			)
		);
		expect(await partOfRow(child.id, parent.id)).not.toBeNull();

		await regionIdRoute.DELETE(
			mkEvent({ params: { id: map.id, rid: region.id } })
		);

		expect(await partOfRow(child.id, parent.id)).toBeNull();
	});

	it('DELETE region keeps part_of(L, P) when another polygon still references L', async () => {
		const [parent] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const [child] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Minas Tirith' })
			.returning();
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Gondor map', locationId: parent.id } }))
		);
		const region1 = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon, locationId: child.id }
				})
			)
		);
		await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: {
					polygon: [[200, 200], [300, 200], [300, 300], [200, 300]],
					locationId: child.id
				}
			})
		);

		await regionIdRoute.DELETE(
			mkEvent({ params: { id: map.id, rid: region1.id } })
		);

		expect(await partOfRow(child.id, parent.id)).not.toBeNull();
	});

	it('PATCH locationId change drops the old edge and adds the new one', async () => {
		const [parent] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const [first] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Minas Tirith' })
			.returning();
		const [second] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Pelargir' })
			.returning();
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Gondor map', locationId: parent.id } }))
		);
		const region = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon, locationId: first.id }
				})
			)
		);
		expect(await partOfRow(first.id, parent.id)).not.toBeNull();

		await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { locationId: second.id }
			})
		);

		expect(await partOfRow(first.id, parent.id)).toBeNull();
		expect(await partOfRow(second.id, parent.id)).not.toBeNull();
	});

	it('PATCH locationId to null drops the implied edge', async () => {
		const [parent] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const [child] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Minas Tirith' })
			.returning();
		const map = await readJson(
			await CREATE_MAP(mkEvent({ body: { name: 'Gondor map', locationId: parent.id } }))
		);
		const region = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon, locationId: child.id }
				})
			)
		);
		expect(await partOfRow(child.id, parent.id)).not.toBeNull();

		await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { locationId: null }
			})
		);

		expect(await partOfRow(child.id, parent.id)).toBeNull();
	});
});

describe('removeImpliedPartOf — cross-map sibling check (Codex P1)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('preserves the part_of edge when a sibling variant map still draws the child region', async () => {
		const polygon = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10]
		];

		const { seedActs } = await import('../helpers/test-db.js');
		const { act0, act1, act2 } = await seedActs(currentDb, userId);

		const [parent] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Parent', position: 0 })
			.returning();
		const [child] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Child', position: 1 })
			.returning();

		// Two non-overlapping variant maps for the same parent location.
		// Bounds [act0,act0] and [act2,act2] — different position ranges,
		// neither is a default, so the one-default-per-location and
		// variant-no-overlap constraints both pass.
		const mapA = await readJson(
			await CREATE_MAP(
				mkEvent({
					body: {
						name: 'Parent map A',
						locationId: parent.id,
						startActId: act0,
						endActId: act0
					}
				})
			)
		);
		const mapB = await readJson(
			await CREATE_MAP(
				mkEvent({
					body: {
						name: 'Parent map B',
						locationId: parent.id,
						startActId: act2,
						endActId: act2
					}
				})
			)
		);
		void act1;

		// Draw the child on BOTH maps.
		const regionA = await readJson(
			await CREATE_REGION(
				mkEvent({ params: { id: mapA.id }, body: { polygon, locationId: child.id } })
			)
		);
		await CREATE_REGION(
			mkEvent({ params: { id: mapB.id }, body: { polygon, locationId: child.id } })
		);

		// The implied edge should exist.
		const edgeBefore = await currentDb
			.select()
			.from(relationships)
			.where(
				and(
					eq(relationships.fromId, child.id),
					eq(relationships.toId, parent.id),
					eq(relationships.type, 'part_of')
				)
			);
		expect(edgeBefore).toHaveLength(1);

		// Delete the region on mapA. Edge MUST survive because mapB still draws it.
		await regionIdRoute.DELETE(
			mkEvent({ params: { id: mapA.id, rid: regionA.id } })
		);

		const edgeAfter = await currentDb
			.select()
			.from(relationships)
			.where(
				and(
					eq(relationships.fromId, child.id),
					eq(relationships.toId, parent.id),
					eq(relationships.type, 'part_of')
				)
			);
		expect(edgeAfter).toHaveLength(1);
	});
});

describe('POST /api/maps — scene-FK normalization (Codex P2)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('drops scene FKs when their parent act FK is absent (default-variant payload)', async () => {
		const { seedActs } = await import('../helpers/test-db.js');
		const { act0 } = await seedActs(currentDb, userId);
		const [scene] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', parentId: act0, name: 'Scene A', position: 0 })
			.returning();

		const res = await CREATE_MAP(
			mkEvent({ body: { name: 'Default-ish', startSceneId: scene.id, endSceneId: scene.id } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		// Without parent act FKs, both scene FKs must be cleared so the row is a
		// well-formed default variant (no half-anchored state).
		expect(body.startActId).toBeNull();
		expect(body.endActId).toBeNull();
		expect(body.startSceneId).toBeNull();
		expect(body.endSceneId).toBeNull();
		expect(body.startPosition).toBeNull();
		expect(body.endPosition).toBeNull();
	});
});

describe('recomputeWorldMapVariantsAll — degenerate-variant normalization (Codex P1)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('unlinks degenerate variant when an existing default for the same Location would conflict', async () => {
		const { seedActs } = await import('../helpers/test-db.js');
		const { recomputeWorldMapVariantsAll } = await import(
			'../../src/lib/server/world-maps.js'
		);
		const { worldMaps } = await import('../../src/lib/server/db/schema.js');
		const { act0, act1 } = await seedActs(currentDb, userId);

		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Mordor', position: 0 })
			.returning();

		// Default variant for the location (start_position IS NULL).
		await CREATE_MAP(mkEvent({ body: { name: 'Mordor default', locationId: loc.id } }));
		// Scoped variant anchored to act0→act1.
		const scoped = await readJson(
			await CREATE_MAP(
				mkEvent({
					body: {
						name: 'Mordor act0-1',
						locationId: loc.id,
						startActId: act0,
						endActId: act1
					}
				})
			)
		);

		// Simulate ON DELETE SET NULL on endActId — leaves scoped row degenerate
		// (one act FK surviving) with stale start_position.
		await currentDb
			.update(worldMaps)
			.set({ endActId: null })
			.where(eq(worldMaps.id, scoped.id));

		// Recompute must not throw on the unique-index conflict.
		await expect(recomputeWorldMapVariantsAll(currentDb, userId)).resolves.toBeGreaterThanOrEqual(1);

		const [after] = await currentDb
			.select()
			.from(worldMaps)
			.where(eq(worldMaps.id, scoped.id));
		// Degenerate row got unlinked from the location to avoid the duplicate-default collision.
		expect(after.locationId).toBeNull();
		expect(after.startActId).toBeNull();
		expect(after.endActId).toBeNull();
		expect(after.startPosition).toBeNull();
		expect(after.endPosition).toBeNull();
	});

	it('clears bounds in-place when degenerate variant has no conflicting default', async () => {
		const { seedActs } = await import('../helpers/test-db.js');
		const { recomputeWorldMapVariantsAll } = await import(
			'../../src/lib/server/world-maps.js'
		);
		const { worldMaps } = await import('../../src/lib/server/db/schema.js');
		const { act0, act1 } = await seedActs(currentDb, userId);

		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Shire', position: 0 })
			.returning();

		// Only a scoped variant; no default exists.
		const scoped = await readJson(
			await CREATE_MAP(
				mkEvent({
					body: {
						name: 'Shire act0-1',
						locationId: loc.id,
						startActId: act0,
						endActId: act1
					}
				})
			)
		);

		await currentDb
			.update(worldMaps)
			.set({ startActId: null })
			.where(eq(worldMaps.id, scoped.id));

		await expect(recomputeWorldMapVariantsAll(currentDb, userId)).resolves.toBeGreaterThanOrEqual(1);

		const [after] = await currentDb
			.select()
			.from(worldMaps)
			.where(eq(worldMaps.id, scoped.id));
		// No conflict, so the row stays linked and just becomes the default.
		expect(after.locationId).toBe(loc.id);
		expect(after.startActId).toBeNull();
		expect(after.endActId).toBeNull();
		expect(after.startPosition).toBeNull();
		expect(after.endPosition).toBeNull();
	});
});

// Slice 1b A1 — every world_maps row gets a baseline anchor at
// t_position=-Infinity so the Pixi renderer (which reads state via
// projectState) doesn't render an empty map under ?renderer=pixi.
// G1 covers POST /api/maps; G2 covers POST /api/maps/[id]/duplicate.
describe('Slice 1b — baseline anchor invariant (G1 + G2)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('G1: POST /api/maps inserts one baseline anchor at -Infinity with empty state', async () => {
		const res = await CREATE_MAP(mkEvent({ body: { name: 'Fresh Map' } }));
		expect(res.status).toBe(201);
		const map = await readJson(res);

		const anchors = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		expect(anchors).toHaveLength(1);
		// Drizzle's doublePrecision round-trips Number.NEGATIVE_INFINITY as the
		// JS constant; Postgres stores it as -Infinity (float8 special value).
		expect(anchors[0].tPosition).toBe(Number.NEGATIVE_INFINITY);
		expect(anchors[0].stateJsonb).toEqual({
			regions: [],
			artifacts: [],
			chains: []
		});
	});

	it('G1: anchor + map insert is atomic — if the row insert fails, no orphan anchor', async () => {
		// Trip the "default variant already exists" check with a duplicate locationId.
		// First map for the location succeeds; second should fail at the worldMaps
		// insert (unique partial index) before any anchor is created.
		const [loc] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Loc' })
			.returning();
		await CREATE_MAP(mkEvent({ body: { name: 'A', locationId: loc.id } }));
		await expect(
			CREATE_MAP(mkEvent({ body: { name: 'B', locationId: loc.id } }))
		).rejects.toMatchObject({ status: 409 });

		// Exactly one map → exactly one anchor. If the transaction leaked, we'd
		// see an anchor for the failed B insert with no matching world_maps row,
		// which the FK + cascade would prevent anyway — this is the belt-and-
		// suspenders assertion.
		const maps = await currentDb
			.select()
			.from(worldMaps)
			.where(eq(worldMaps.userId, userId));
		expect(maps).toHaveLength(1);
		const anchors = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, maps[0].id));
		expect(anchors).toHaveLength(1);
	});

	it('G2: duplicateMap creates a baseline anchor referencing the cloned regions, not the source regions', async () => {
		// Source map with two regions linked to two Locations.
		const [locA] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'A' })
			.returning();
		const [locB] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Location', name: 'B' })
			.returning();
		const sourceRes = await CREATE_MAP(mkEvent({ body: { name: 'Source' } }));
		const source = await readJson(sourceRes);

		const regionA = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: source.id },
					body: {
						locationId: locA.id,
						polygon: [[0, 0], [0, 10], [10, 10]]
					}
				})
			)
		);
		const regionB = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: source.id },
					body: {
						locationId: locB.id,
						polygon: [[20, 20], [20, 30], [30, 30]]
					}
				})
			)
		);

		const cloneRes = await DUPLICATE_MAP(
			mkEvent({ params: { id: source.id } })
		);
		expect(cloneRes.status).toBe(201);
		const clone = await readJson(cloneRes);
		expect(clone.regions).toHaveLength(2);

		// Anchor's region_ids must point at the CLONE's regions, not the source's.
		// Stale source-region refs would lazy-GC under projection and render an
		// empty map under ?renderer=pixi — the iron-rule parity violation A1
		// exists to prevent.
		const anchors = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, clone.id));
		expect(anchors).toHaveLength(1);
		expect(anchors[0].tPosition).toBe(Number.NEGATIVE_INFINITY);

		const state = anchors[0].stateJsonb as {
			regions: { region_id: string; faction_id: string | null }[];
			artifacts: unknown[];
			chains: unknown[];
		};
		expect(state.regions).toHaveLength(2);
		const cloneRegionIds = clone.regions.map((r: { id: string }) => r.id).sort();
		const anchorRegionIds = state.regions.map((r) => r.region_id).sort();
		expect(anchorRegionIds).toEqual(cloneRegionIds);
		// No anchor entry should reference a SOURCE region id.
		const sourceRegionIds = new Set([regionA.id, regionB.id]);
		for (const ref of state.regions) {
			expect(sourceRegionIds.has(ref.region_id)).toBe(false);
		}
		// Slice 2 D1: faction_id is set to the user's Neutral faction
		// (created by the migration / signup hook / ensureNeutralFaction).
		// Color field no longer present.
		for (const ref of state.regions) {
			expect(ref.faction_id).toBeTruthy();
		}
		expect(state.artifacts).toEqual([]);
		expect(state.chains).toEqual([]);
	});

	it('G2: duplicating a region-less map still produces one baseline anchor with empty regions', async () => {
		const sourceRes = await CREATE_MAP(mkEvent({ body: { name: 'Empty' } }));
		const source = await readJson(sourceRes);
		const cloneRes = await DUPLICATE_MAP(
			mkEvent({ params: { id: source.id } })
		);
		const clone = await readJson(cloneRes);

		const anchors = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, clone.id));
		expect(anchors).toHaveLength(1);
		expect(anchors[0].stateJsonb).toEqual({
			regions: [],
			artifacts: [],
			chains: []
		});
	});

	it('G2: source map keeps its own baseline anchor untouched after duplicate', async () => {
		const sourceRes = await CREATE_MAP(mkEvent({ body: { name: 'Source' } }));
		const source = await readJson(sourceRes);
		const sourceAnchorsBefore = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, source.id));

		await DUPLICATE_MAP(mkEvent({ params: { id: source.id } }));

		const sourceAnchorsAfter = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, source.id));
		expect(sourceAnchorsAfter).toHaveLength(sourceAnchorsBefore.length);
		expect(sourceAnchorsAfter[0].id).toBe(sourceAnchorsBefore[0].id);
	});
});

// Slice 1b A3 — region write-through to anchor state_jsonb.regions[].
// G6 extends Δ1b-F to cover all three region CRUD verbs (POST/PATCH/DELETE).
// Iron-rule parity: under ?renderer=pixi, projectState reads regions from
// the anchor's state_jsonb; under ?renderer=leaflet, regions are read
// directly from the map_regions table. Both must stay consistent.
describe('Slice 1b — region write-through (G6)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	async function readAnchor(mapId: string) {
		const rows = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, mapId));
		expect(rows).toHaveLength(1); // baseline anchor only in these tests
		return rows[0];
	}

	it('POST /api/maps/[id]/regions adds the new region to every anchor', async () => {
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'M' } }));
		const map = await readJson(mapRes);

		// Baseline anchor starts with regions: [] (per commit 3a).
		const before = await readAnchor(map.id);
		const beforeState = before.stateJsonb as {
			regions: Array<{ region_id: string }>;
		};
		expect(beforeState.regions).toEqual([]);

		const regionRes = await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: {
					polygon: [[0, 0], [0, 10], [10, 10]]
				}
			})
		);
		const region = await readJson(regionRes);

		const after = await readAnchor(map.id);
		const afterState = after.stateJsonb as {
			regions: Array<{ region_id: string; faction_id: string | null }>;
		};
		expect(afterState.regions).toHaveLength(1);
		// Slice 2 D1: faction_id is the user's Neutral faction. Color field
		// is no longer written by the POST flow.
		expect(afterState.regions[0].region_id).toBe(region.id);
		expect(afterState.regions[0].faction_id).toBeTruthy();
	});

	// Slice 2 D1: "PATCH updates color in anchor state" and "PATCH preserves
	// faction_id during color edit" were tests against the now-removed
	// color column. Tests deleted intentionally; faction-overlay survival
	// during polygon edits is covered by T4 anchor-schema work.

	it('DELETE /api/maps/[id]/regions/[rid] removes the region from anchor state', async () => {
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'M' } }));
		const map = await readJson(mapRes);
		const region = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon: [[0, 0], [0, 10], [10, 10]] }
				})
			)
		);

		await regionIdRoute.DELETE(
			mkEvent({ params: { id: map.id, rid: region.id } })
		);

		const after = await readAnchor(map.id);
		const afterState = after.stateJsonb as {
			regions: Array<{ region_id: string }>;
		};
		expect(afterState.regions).toEqual([]);
	});

	it('multiple anchors on the same map all see the write-through', async () => {
		// Manually seed a second anchor so the fan-out has more than one
		// target. Slice 1b only exposes user-authored anchors via the
		// snapshot UX, so this test simulates that pre-existing state.
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'M' } }));
		const map = await readJson(mapRes);
		await currentDb.insert(mapAnchors).values({
			worldMapId: map.id,
			tPosition: 5,
			stateJsonb: { regions: [], artifacts: [], chains: [] }
		});

		const region = await readJson(
			await CREATE_REGION(
				mkEvent({
					params: { id: map.id },
					body: { polygon: [[0, 0], [0, 10], [10, 10]] }
				})
			)
		);

		const allAnchors = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		expect(allAnchors).toHaveLength(2);
		for (const a of allAnchors) {
			const state = a.stateJsonb as { regions: Array<{ region_id: string }> };
			expect(state.regions.map((r) => r.region_id)).toContain(region.id);
		}
	});
});

describe('Slice 2 D5 — cursor pagination', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	async function makeMapWith(eventCount: number): Promise<string> {
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'P' } }));
		const map = await readJson(mapRes);
		if (eventCount === 0) return map.id;
		// Direct DB insert is dramatically faster than POSTing N events.
		// Slice 1b's POST /events runs the polymorphic-FK validator + the
		// projection-readiness chain on every call. For pagination tests
		// we only need ordered rows; the validation paths are covered
		// elsewhere.
		const rows = [];
		for (let i = 0; i < eventCount; i++) {
			rows.push({
				worldMapId: map.id,
				tPosition: i,
				kind: 'transfer_region',
				// payload references non-existent ids; projection skips
				// unresolvable refs (lazy GC, design doc line 268). Fine
				// for pagination ordering tests.
				payloadJsonb: { region_id: crypto.randomUUID(), new_faction_id: crypto.randomUUID() }
			});
		}
		await currentDb.insert(mapEvents).values(rows);
		return map.id;
	}

	function listUrl(path: string, params: Record<string, string>): URL {
		const u = new URL(`http://localhost${path}`);
		for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
		return u;
	}

	it('paginates events: 1500 rows + limit=500 → 3 pages, then next_cursor null', async () => {
		const mapId = await makeMapWith(1500);
		const collected: unknown[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const params: Record<string, string> = { limit: '500' };
			if (cursor) params.after = cursor;
			const res = await LIST_EVENTS(
				mkEvent({ url: listUrl(`/api/maps/${mapId}/events`, params), params: { id: mapId } })
			);
			const body = await readJson(res);
			collected.push(...body.rows);
			cursor = body.next_cursor;
			pages++;
			if (pages > 5) throw new Error('pagination loop did not terminate');
		} while (cursor != null);
		expect(pages).toBe(3); // 500 + 500 + 500 → last page non-full → null
		expect(collected).toHaveLength(1500);
		// Stable ordering: t_position ascending.
		const positions = collected.map((r) => (r as { tPosition: number }).tPosition);
		const sorted = [...positions].sort((a, b) => a - b);
		expect(positions).toEqual(sorted);
	});

	it('returns next_cursor: null when result page is non-full', async () => {
		const mapId = await makeMapWith(7);
		const res = await LIST_EVENTS(
			mkEvent({ url: listUrl(`/api/maps/${mapId}/events`, { limit: '10' }), params: { id: mapId } })
		);
		const body = await readJson(res);
		expect(body.rows).toHaveLength(7);
		expect(body.next_cursor).toBeNull();
	});

	it('returns next_cursor: null on empty list', async () => {
		const mapId = await makeMapWith(0);
		const res = await LIST_EVENTS(
			mkEvent({ url: listUrl(`/api/maps/${mapId}/events`, {}), params: { id: mapId } })
		);
		const body = await readJson(res);
		expect(body.rows).toEqual([]);
		expect(body.next_cursor).toBeNull();
	});

	it('rejects malformed cursor with 400', async () => {
		const mapId = await makeMapWith(5);
		await expect(
			LIST_EVENTS(
				mkEvent({
					url: listUrl(`/api/maps/${mapId}/events`, { after: 'not-a-real-cursor' }),
					params: { id: mapId }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('cursor does not leak across users (auth-isolation)', async () => {
		const mapIdA = await makeMapWith(20);
		// Get user A's cursor at the end of page 1.
		const resA = await LIST_EVENTS(
			mkEvent({
				url: listUrl(`/api/maps/${mapIdA}/events`, { limit: '10' }),
				params: { id: mapIdA }
			})
		);
		const bodyA = await readJson(resA);
		expect(bodyA.next_cursor).not.toBeNull();
		const cursorFromUserA = bodyA.next_cursor as string;

		// User B tries to use user A's cursor against their OWN map (different mapId).
		// Even if the cursor decodes, ownership check blocks at the route level.
		const userB = await seedTestUser(currentDb, { name: 'B', email: 'b@b.com' });
		const prevUserId = userId;
		userId = userB.id;
		const mapIdB = await makeMapWith(5);
		// User B requests A's map with A's cursor → 404 (ownership guard).
		await expect(
			LIST_EVENTS(
				mkEvent({
					url: listUrl(`/api/maps/${mapIdA}/events`, {
						limit: '10',
						after: cursorFromUserA
					}),
					params: { id: mapIdA }
				})
			)
		).rejects.toMatchObject({ status: 404 });
		// User B requests B's map with A's cursor → cursor is opaque but
		// the rows it filters are B's rows; user A's data does not leak.
		const resB = await LIST_EVENTS(
			mkEvent({
				url: listUrl(`/api/maps/${mapIdB}/events`, {
					limit: '10',
					after: cursorFromUserA
				}),
				params: { id: mapIdB }
			})
		);
		const bodyB = await readJson(resB);
		// User B's events come AFTER user A's cursor at (t=9), so user B
		// only sees B's events with t_position > 9 — that's 0 events if
		// B's seeded events are at t=0..4. The point is rows.length is
		// scoped to B's map regardless of A's cursor.
		for (const row of bodyB.rows) {
			expect((row as { worldMapId: string }).worldMapId).toBe(mapIdB);
		}
		userId = prevUserId;
	});

	it('anchors paginate with the same scheme', async () => {
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'A' } }));
		const map = await readJson(mapRes);
		// The baseline anchor at t=-Infinity is already there; add 14 more.
		const anchorRows = [];
		for (let i = 0; i < 14; i++) {
			anchorRows.push({
				worldMapId: map.id,
				tPosition: i + 1,
				stateJsonb: { regions: [], artifacts: [], chains: [] }
			});
		}
		await currentDb.insert(mapAnchors).values(anchorRows);

		const res1 = await LIST_ANCHORS(
			mkEvent({
				url: listUrl(`/api/maps/${map.id}/anchors`, { limit: '10' }),
				params: { id: map.id }
			})
		);
		const body1 = await readJson(res1);
		expect(body1.rows).toHaveLength(10);
		expect(body1.next_cursor).not.toBeNull();

		const res2 = await LIST_ANCHORS(
			mkEvent({
				url: listUrl(`/api/maps/${map.id}/anchors`, {
					limit: '10',
					after: body1.next_cursor as string
				}),
				params: { id: map.id }
			})
		);
		const body2 = await readJson(res2);
		expect(body2.rows.length).toBeGreaterThan(0);
		expect(body2.next_cursor).toBeNull();
		// No duplicates across pages.
		const ids1 = new Set(body1.rows.map((r: { id: string }) => r.id));
		for (const r of body2.rows as Array<{ id: string }>) expect(ids1.has(r.id)).toBe(false);
	});

	it('factions paginate by createdAt', async () => {
		const factionRows = [];
		for (let i = 0; i < 12; i++) {
			factionRows.push({
				userId,
				name: `F${i}`,
				color: '#ff0000'
			});
		}
		await currentDb.insert(factions).values(factionRows);

		const res1 = await LIST_FACTIONS(
			mkEvent({ url: listUrl('/api/factions', { limit: '5' }) })
		);
		const body1 = await readJson(res1);
		expect(body1.rows).toHaveLength(5);
		expect(body1.next_cursor).not.toBeNull();

		const res2 = await LIST_FACTIONS(
			mkEvent({
				url: listUrl('/api/factions', { limit: '5', after: body1.next_cursor as string })
			})
		);
		const body2 = await readJson(res2);
		expect(body2.rows).toHaveLength(5);

		const res3 = await LIST_FACTIONS(
			mkEvent({
				url: listUrl('/api/factions', { limit: '5', after: body2.next_cursor as string })
			})
		);
		const body3 = await readJson(res3);
		expect(body3.rows).toHaveLength(2);
		expect(body3.next_cursor).toBeNull();
	});
});

describe('Slice 2 D1 — factions.is_system guards', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	async function makeFaction(opts: { isSystem?: boolean } = {}): Promise<{ id: string }> {
		// CREATE_FACTION goes through the validated POST, which doesn't
		// expose is_system. For the is_system=true row used by these tests
		// we insert directly — that mirrors how the migration seeds the
		// per-user Neutral on user creation (T3).
		if (opts.isSystem) {
			const [row] = await currentDb
				.insert(factions)
				.values({ userId, name: 'Neutral', color: '#9CA3AF', isSystem: true })
				.returning();
			return { id: row.id };
		}
		const res = await CREATE_FACTION(
			mkEvent({ body: { name: 'Allies', color: '#2dd4bf' } })
		);
		return (await readJson(res)) as { id: string };
	}

	it('DELETE on is_system=true returns 422', async () => {
		const sys = await makeFaction({ isSystem: true });
		await expect(
			factionIdRoute.DELETE(mkEvent({ params: { id: sys.id } }))
		).rejects.toMatchObject({ status: 422 });
		// Row still exists.
		const remaining = await currentDb
			.select({ id: factions.id })
			.from(factions)
			.where(eq(factions.id, sys.id));
		expect(remaining).toHaveLength(1);
	});

	it('DELETE on is_system=false still works (no regression)', async () => {
		const normal = await makeFaction();
		const res = await factionIdRoute.DELETE(mkEvent({ params: { id: normal.id } }));
		expect(res.status).toBe(204);
	});

	it('PATCH cannot set isSystem on a normal faction', async () => {
		const normal = await makeFaction();
		await expect(
			factionIdRoute.PATCH(
				mkEvent({ params: { id: normal.id }, body: { isSystem: true } })
			)
		).rejects.toMatchObject({ status: 422 });
	});

	it('PATCH name/color on a system faction is allowed (user owns it)', async () => {
		const sys = await makeFaction({ isSystem: true });
		const res = await factionIdRoute.PATCH(
			mkEvent({
				params: { id: sys.id },
				body: { name: 'Independent', color: '#888888' }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.name).toBe('Independent');
		expect(body.isSystem).toBe(true);
	});

	it('partial unique index rejects a second is_system row for the same user', async () => {
		await makeFaction({ isSystem: true });
		await expect(
			currentDb
				.insert(factions)
				.values({ userId, name: 'Neutral2', color: '#000000', isSystem: true })
		).rejects.toThrow();
	});

	it('two different users can each have their own is_system row', async () => {
		await makeFaction({ isSystem: true });
		const userB = await seedTestUser(currentDb, { name: 'B', email: 'b@b.com' });
		// Direct insert — partial unique is scoped per user_id, so this
		// must succeed.
		const [bRow] = await currentDb
			.insert(factions)
			.values({ userId: userB.id, name: 'Neutral', color: '#9CA3AF', isSystem: true })
			.returning();
		expect(bRow.isSystem).toBe(true);
	});

	it('CREATE_FACTION never produces an is_system row', async () => {
		const created = await readJson(
			await CREATE_FACTION(mkEvent({ body: { name: 'X', color: '#ff0000' } }))
		);
		expect(created.isSystem).toBe(false);
	});
});

describe('Slice 2 D1 — Neutral faction backfill (T3)', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
		const _user = await seedTestUser(currentDb);
		userId = _user.id;
	});

	it('first region POST creates a Neutral faction for the user', async () => {
		// Before any region is created, no factions exist for this user.
		const before = await currentDb
			.select()
			.from(factions)
			.where(eq(factions.userId, userId));
		expect(before).toHaveLength(0);

		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'M' } }));
		const map = await readJson(mapRes);
		await CREATE_REGION(
			mkEvent({
				params: { id: map.id },
				body: { polygon: [[0, 0], [0, 10], [10, 10]] }
			})
		);

		const after = await currentDb
			.select()
			.from(factions)
			.where(eq(factions.userId, userId));
		expect(after).toHaveLength(1);
		expect(after[0].isSystem).toBe(true);
		expect(after[0].name).toBe('Neutral');
		expect(after[0].color).toBe('#9ca3af');
	});

	it('subsequent region POSTs do not create a second Neutral (idempotent)', async () => {
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'M' } }));
		const map = await readJson(mapRes);
		await CREATE_REGION(
			mkEvent({ params: { id: map.id }, body: { polygon: [[0, 0], [0, 10], [10, 10]] } })
		);
		await CREATE_REGION(
			mkEvent({ params: { id: map.id }, body: { polygon: [[20, 20], [20, 30], [30, 30]] } })
		);

		const all = await currentDb
			.select()
			.from(factions)
			.where(and(eq(factions.userId, userId), eq(factions.isSystem, true)));
		expect(all).toHaveLength(1);
	});

	it('anchor regions[] entries point at the user Neutral faction id', async () => {
		const mapRes = await CREATE_MAP(mkEvent({ body: { name: 'M' } }));
		const map = await readJson(mapRes);
		await CREATE_REGION(
			mkEvent({ params: { id: map.id }, body: { polygon: [[0, 0], [0, 10], [10, 10]] } })
		);

		const [neutral] = await currentDb
			.select({ id: factions.id })
			.from(factions)
			.where(and(eq(factions.userId, userId), eq(factions.isSystem, true)));

		const [anchor] = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, map.id));
		const state = anchor.stateJsonb as {
			regions: Array<{ region_id: string; faction_id: string }>;
		};
		expect(state.regions).toHaveLength(1);
		expect(state.regions[0].faction_id).toBe(neutral.id);
	});

	it('two users get distinct Neutral factions (per-user partitioning)', async () => {
		const mapA = await readJson(await CREATE_MAP(mkEvent({ body: { name: 'A' } })));
		await CREATE_REGION(
			mkEvent({ params: { id: mapA.id }, body: { polygon: [[0, 0], [0, 10], [10, 10]] } })
		);
		const userB = await seedTestUser(currentDb, { name: 'B', email: 'b@b.com' });
		const prevUserId = userId;
		userId = userB.id;
		const mapB = await readJson(await CREATE_MAP(mkEvent({ body: { name: 'B' } })));
		await CREATE_REGION(
			mkEvent({ params: { id: mapB.id }, body: { polygon: [[0, 0], [0, 10], [10, 10]] } })
		);
		userId = prevUserId;

		const aNeutral = await currentDb
			.select({ id: factions.id })
			.from(factions)
			.where(and(eq(factions.userId, prevUserId), eq(factions.isSystem, true)));
		const bNeutral = await currentDb
			.select({ id: factions.id })
			.from(factions)
			.where(and(eq(factions.userId, userB.id), eq(factions.isSystem, true)));
		expect(aNeutral).toHaveLength(1);
		expect(bNeutral).toHaveLength(1);
		expect(aNeutral[0].id).not.toBe(bNeutral[0].id);
	});

	it('duplicate map uses Neutral as faction_id on cloned regions', async () => {
		const sourceRes = await CREATE_MAP(mkEvent({ body: { name: 'Source' } }));
		const source = await readJson(sourceRes);
		await CREATE_REGION(
			mkEvent({ params: { id: source.id }, body: { polygon: [[0, 0], [0, 10], [10, 10]] } })
		);

		const cloneRes = await DUPLICATE_MAP(mkEvent({ params: { id: source.id } }));
		const clone = await readJson(cloneRes);

		const [neutral] = await currentDb
			.select({ id: factions.id })
			.from(factions)
			.where(and(eq(factions.userId, userId), eq(factions.isSystem, true)));

		const [anchor] = await currentDb
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.worldMapId, clone.id));
		const state = anchor.stateJsonb as {
			regions: Array<{ region_id: string; faction_id: string }>;
		};
		expect(state.regions).toHaveLength(1);
		expect(state.regions[0].faction_id).toBe(neutral.id);
	});
});
