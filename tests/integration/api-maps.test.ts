/**
 * Vitest integration tests for /api/maps handlers.
 *
 * Calls SvelteKit handler functions directly with mock RequestEvent objects.
 * The `$lib/server/db/index.js` module is mocked with an in-process PGlite instance.
 * SvelteKit error() throws HttpError — use rejects.toMatchObject to assert status.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { entities } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock('$lib/server/db/index.js', () => ({
	getDb: async () => currentDb
}));

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
		}
	};
}

describe('/api/maps GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
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
			.values({ type: 'Location', name: 'Forest' })
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
			.values({ type: 'Location', name: 'Castle' })
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
		expect(body.baseImageUrl).toMatch(/^\/maps\//);
		expect(body.width).toBe(1);
		expect(body.height).toBe(1);
	});
});
