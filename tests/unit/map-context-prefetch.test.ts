// Cinematic Spotlight (Slice 8) #505 — staged-prefetch store surface.
//
// Pins the prefetch/applyPrefetched methods the "Option 1" atomic cycle commit
// added to the four map-scoped stores (anchors, events, layer-prefs, placements),
// mirroring the regions store the world-map-store-ordering test already covers.
//
// The load-bearing safety property: applyPrefetched(B) must make an in-flight
// load(A) a no-op when it resolves later, so a cycle commit can't be clobbered by
// a slow earlier load (the anti-clobber invariant). Each store enforces this via
// its own stale guard (lastLoadedMapId and/or a monotonic load token); these tests
// exercise that guard through the new apply path.
//
// Style mirrors world-map-store-ordering.test.ts (globalThis.fetch mock + the
// shared singleton stores).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { mapAnchorsStore, type MapAnchor } from '../../src/lib/features/map/map-anchors-store.js';
import { mapEventsStore, type MapEvent } from '../../src/lib/features/map/map-events-store.js';
import { layerPrefs } from '../../src/lib/features/map/layer-prefs-store.js';
import { mapPlacements } from '../../src/lib/stores/map-placements.js';
import type { MapPlacement } from '../../src/lib/types/map-placement.js';

function resp(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}
// A deferred fetch whose resolution the test controls, to open an in-flight window.
function deferredFetch(): { resolve: (r: Response) => void } {
	let resolve!: (r: Response) => void;
	globalThis.fetch = vi
		.fn()
		.mockReturnValue(new Promise<Response>((res) => (resolve = res))) as unknown as typeof fetch;
	return { resolve };
}

const anchor = (id: string, mapId: string): MapAnchor =>
	({
		id,
		worldMapId: mapId,
		tPosition: 0,
		stateJsonb: { regions: [] },
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	}) as unknown as MapAnchor;
const event = (id: string, mapId: string): MapEvent =>
	({ id, worldMapId: mapId, tPosition: 0, createdAt: '2026-01-01T00:00:00.000Z' }) as unknown as MapEvent;
const placement = (id: string): MapPlacement => ({ id }) as unknown as MapPlacement;

beforeEach(() => {
	mapAnchorsStore.reset();
	mapEventsStore.reset();
	layerPrefs.reset();
	mapPlacements.reset();
	globalThis.fetch = vi.fn().mockResolvedValue(resp([])) as unknown as typeof fetch;
});

describe('mapAnchorsStore prefetch / applyPrefetched', () => {
	it('prefetch pages rows WITHOUT touching the store', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(resp({ rows: [anchor('a1', 'A')], next_cursor: null })) as unknown as typeof fetch;
		const before = get(mapAnchorsStore);
		const rows = await mapAnchorsStore.prefetch('A');
		expect(rows.map((r) => r.id)).toEqual(['a1']);
		expect(get(mapAnchorsStore)).toBe(before); // untouched — that's the point of prefetch
	});

	it('applyPrefetched(B) supersedes an in-flight load(A) (anti-clobber)', async () => {
		const d = deferredFetch();
		const loadA = mapAnchorsStore.load('A'); // in flight, store still empty
		mapAnchorsStore.applyPrefetched('B', [anchor('b1', 'B')]); // cycle commit
		expect(get(mapAnchorsStore).map((r) => r.id)).toEqual(['b1']);
		d.resolve(resp({ rows: [anchor('a1', 'A')], next_cursor: null })); // stale A response
		await loadA;
		expect(get(mapAnchorsStore).map((r) => r.id)).toEqual(['b1']); // not clobbered
	});
});

describe('mapEventsStore prefetch / applyPrefetched', () => {
	it('prefetch pages rows WITHOUT touching the store', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(resp({ rows: [event('e1', 'A')], next_cursor: null })) as unknown as typeof fetch;
		const before = get(mapEventsStore);
		const rows = await mapEventsStore.prefetch('A');
		expect(rows.map((r) => r.id)).toEqual(['e1']);
		expect(get(mapEventsStore)).toBe(before);
	});

	it('applyPrefetched(B) supersedes an in-flight load(A) (anti-clobber)', async () => {
		const d = deferredFetch();
		const loadA = mapEventsStore.load('A');
		mapEventsStore.applyPrefetched('B', [event('b1', 'B')]);
		expect(get(mapEventsStore).map((r) => r.id)).toEqual(['b1']);
		d.resolve(resp({ rows: [event('a1', 'A')], next_cursor: null }));
		await loadA;
		expect(get(mapEventsStore).map((r) => r.id)).toEqual(['b1']);
	});
});

describe('layerPrefs prefetch / applyPrefetched', () => {
	it('prefetch returns the prefs map and never throws on error (defaults-visible)', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(resp([{ layerKey: 'regions', visible: 0 }])) as unknown as typeof fetch;
		const prefs = await layerPrefs.prefetch('A');
		expect(prefs.get('regions')).toBe(false);

		globalThis.fetch = vi.fn().mockResolvedValue(resp('nope', false, 404)) as unknown as typeof fetch;
		await expect(layerPrefs.prefetch('A')).resolves.toEqual(new Map()); // 404 → empty (defaults)
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch;
		await expect(layerPrefs.prefetch('A')).resolves.toEqual(new Map()); // network → empty
	});

	it('applyPrefetched installs loaded state and supersedes an in-flight load (no flash to empty)', async () => {
		const d = deferredFetch();
		const loadA = layerPrefs.load('A'); // flips state to 'loading' (the flash this avoids)
		layerPrefs.applyPrefetched('B', new Map([['regions', false]]));
		expect(get(layerPrefs)).toMatchObject({ mapId: 'B', status: 'loaded' });
		d.resolve(resp([{ layerKey: 'regions', visible: 1 }])); // stale A response
		await loadA;
		expect(get(layerPrefs)).toMatchObject({ mapId: 'B', status: 'loaded' }); // not clobbered
		expect(get(layerPrefs).prefs.get('regions')).toBe(false);
	});
});

describe('mapPlacements prefetch / applyPrefetched', () => {
	it('prefetch returns rows WITHOUT touching the store', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(resp([placement('p1')])) as unknown as typeof fetch;
		const before = get(mapPlacements);
		const rows = await mapPlacements.prefetch({ locationId: 'loc-a' });
		expect(rows.map((r) => r.id)).toEqual(['p1']);
		expect(get(mapPlacements)).toBe(before);
	});

	it('applyPrefetched supersedes an in-flight load (anti-clobber)', async () => {
		const d = deferredFetch();
		const loadA = mapPlacements.load({ locationId: 'loc-a' });
		mapPlacements.applyPrefetched([placement('committed')]);
		expect(get(mapPlacements).map((r) => r.id)).toEqual(['committed']);
		d.resolve(resp([placement('stale')]));
		await loadA;
		expect(get(mapPlacements).map((r) => r.id)).toEqual(['committed']);
	});
});
