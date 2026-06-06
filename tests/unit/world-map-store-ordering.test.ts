// Cinematic Spotlight (Slice 8) PR2 — world-map store ordering + prefetch.
//
// Pins the new between-map-cycling store surface and the generation-token stale
// guard the diff introduced (store.ts):
//   - prefetchMapRegions: ok → {map, regions} without touching the shared store;
//     404 → null; other !ok → throw.
//   - applyPrefetchedRegions: commits cached regions AND bumps the generation
//     token, so any older in-flight loadMapRegions is dropped (the A→B→A ABA hole
//     the Codex review called out).
//   - loadMapRegions: a load whose generation was superseded mid-flight resolves
//     to null and does NOT clobber the regions store.
//
// Style mirrors stores-entities-options.test.ts (globalThis.fetch mock + the
// shared singleton store).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { worldMapStore, mapRegions } from '../../src/lib/features/map/store.js';
import type { MapRegion } from '../../src/lib/features/map/types.js';

function makeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}

function region(id: string, mapId: string): MapRegion {
	return { id, mapId, locationId: null, polygon: [], factionId: null } as unknown as MapRegion;
}

// A /api/maps/:id payload: a WorldMap row plus its regions.
function mapPayload(id: string) {
	return { id, name: id, width: 100, height: 100, regions: [region(`${id}-r`, id)] };
}

beforeEach(() => {
	mapRegions.set([]);
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([])) as unknown as typeof fetch;
});

describe('prefetchMapRegions', () => {
	it('returns {map, regions} on ok WITHOUT touching the shared regions store', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse(mapPayload('A'))) as unknown as typeof fetch;
		const before = get(mapRegions);
		const out = await worldMapStore.prefetchMapRegions('A');
		expect(out).not.toBeNull();
		expect(out!.map.id).toBe('A');
		expect(out!.regions.map((r) => r.id)).toEqual(['A-r']);
		// The shared store is untouched — that's the whole point of prefetch.
		expect(get(mapRegions)).toBe(before);
	});

	it('returns null on 404', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse('nope', false, 404)) as unknown as typeof fetch;
		expect(await worldMapStore.prefetchMapRegions('gone')).toBeNull();
	});

	it('throws on a non-404 error', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse('boom', false, 500)) as unknown as typeof fetch;
		await expect(worldMapStore.prefetchMapRegions('A')).rejects.toThrow('Failed to prefetch map');
	});
});

describe('applyPrefetchedRegions', () => {
	it('commits cached regions to the shared store', () => {
		worldMapStore.applyPrefetchedRegions('A', [region('a1', 'A')]);
		expect(get(mapRegions).map((r) => r.id)).toEqual(['a1']);
	});

	it('bumps the generation token so a superseded in-flight load is dropped (ABA hole)', async () => {
		// Start a load of A that resolves slowly, then commit a cached snapshot
		// (bumps the token) before A's fetch resolves. A's late write must be
		// dropped rather than clobbering the committed regions.
		let resolveLoad!: (r: Response) => void;
		globalThis.fetch = vi
			.fn()
			.mockReturnValue(new Promise<Response>((res) => (resolveLoad = res))) as unknown as typeof fetch;

		const loadPromise = worldMapStore.loadMapRegions('A');
		worldMapStore.applyPrefetchedRegions('A', [region('committed', 'A')]);

		resolveLoad(makeResponse(mapPayload('A'))); // stale: token already bumped
		const loaded = await loadPromise;

		expect(loaded).toBeNull(); // load saw it was superseded
		expect(get(mapRegions).map((r) => r.id)).toEqual(['committed']); // not clobbered
	});
});

describe('loadMapRegions — generation guard', () => {
	it('drops a load whose generation was superseded by a newer load mid-flight', async () => {
		// Two concurrent loads; the SECOND wins. The first must resolve to null and
		// leave the store as the second load set it.
		const resolvers: Array<(r: Response) => void> = [];
		globalThis.fetch = vi
			.fn()
			.mockImplementation(() => new Promise<Response>((res) => resolvers.push(res))) as unknown as typeof fetch;

		const p1 = worldMapStore.loadMapRegions('A');
		const p2 = worldMapStore.loadMapRegions('B');

		// B (second, newest generation) resolves first and commits.
		resolvers[1](makeResponse(mapPayload('B')));
		expect(await p2).not.toBeNull();
		expect(get(mapRegions).map((r) => r.id)).toEqual(['B-r']);

		// A (older generation) resolves late and must be dropped.
		resolvers[0](makeResponse(mapPayload('A')));
		expect(await p1).toBeNull();
		expect(get(mapRegions).map((r) => r.id)).toEqual(['B-r']); // still B
	});

	it('returns null on 404 without throwing', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(makeResponse('nope', false, 404)) as unknown as typeof fetch;
		expect(await worldMapStore.loadMapRegions('gone')).toBeNull();
	});
});
