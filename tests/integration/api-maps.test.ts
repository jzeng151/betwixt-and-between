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
import { entities, relationships } from '../../src/lib/server/db/schema.js';

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
				body: { polygon, color: '#ff0000' }
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.polygon).toEqual(polygon);
		expect(body.color).toBe('#ff0000');
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

	it('PATCH updates region color', async () => {
		const { map, region } = await setupMapWithRegion();
		const res = await regionIdRoute.PATCH(
			mkEvent({
				params: { id: map.id, rid: region.id },
				body: { color: '#00ff00' }
			})
		);
		expect(res.status).toBe(200);
		const body = await readJson(res);
		expect(body.color).toBe('#00ff00');
	});

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
					body: { color: '#000' }
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

	it('PATCH sets color to null', async () => {
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
