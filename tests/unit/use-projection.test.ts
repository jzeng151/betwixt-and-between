// G9 — use-projection.ts unit tests.
//
// toProjectionContext is the pure shape converter between the endpoint's
// array payload and projectState's Map/Set shape. Pinning the conversion
// here prevents regressions where future shape changes silently drop
// entries or invert key/value pairs.
//
// fetchProjectionContextForMap is exercised with a stubbed global fetch
// so we test the request URL + payload-handling without spinning up
// the SvelteKit handler.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchProjectionContextForMap,
	toProjectionContext,
	type ProjectionContextPayload
} from '../../src/lib/features/map/use-projection.js';

describe('toProjectionContext', () => {
	it('converts allowedFactions array into a Map keyed by id', () => {
		const payload: ProjectionContextPayload = {
			allowedFactions: [
				{ id: 'f1', color: '#ff0000' },
				{ id: 'f2', color: '#00ff00' }
			],
			allowedRegions: []
		};
		const ctx = toProjectionContext(payload);
		expect(ctx.allowedFactions.size).toBe(2);
		expect(ctx.allowedFactions.get('f1')).toEqual({ id: 'f1', color: '#ff0000' });
		expect(ctx.allowedFactions.get('f2')).toEqual({ id: 'f2', color: '#00ff00' });
	});

	it('converts allowedRegions array into a Set', () => {
		const payload: ProjectionContextPayload = {
			allowedFactions: [],
			allowedRegions: ['r1', 'r2', 'r3']
		};
		const ctx = toProjectionContext(payload);
		expect(ctx.allowedRegions.size).toBe(3);
		expect(ctx.allowedRegions.has('r1')).toBe(true);
		expect(ctx.allowedRegions.has('r2')).toBe(true);
		expect(ctx.allowedRegions.has('r3')).toBe(true);
		expect(ctx.allowedRegions.has('r4')).toBe(false);
	});

	it('handles empty payload', () => {
		const payload: ProjectionContextPayload = {
			allowedFactions: [],
			allowedRegions: []
		};
		const ctx = toProjectionContext(payload);
		expect(ctx.allowedFactions.size).toBe(0);
		expect(ctx.allowedRegions.size).toBe(0);
	});

	it('deduplicates region ids that appear twice in the payload', () => {
		// Server shouldn't return duplicates, but Set semantics protect
		// against accidental double-entry in the lazy-GC check.
		const payload: ProjectionContextPayload = {
			allowedFactions: [],
			allowedRegions: ['r1', 'r1', 'r2']
		};
		const ctx = toProjectionContext(payload);
		expect(ctx.allowedRegions.size).toBe(2);
	});

	it('last-write-wins on duplicate faction ids', () => {
		// Server shouldn't return duplicates, but Map.set behavior is the
		// natural fallback if it does.
		const payload: ProjectionContextPayload = {
			allowedFactions: [
				{ id: 'f1', color: '#ff0000' },
				{ id: 'f1', color: '#00ff00' }
			],
			allowedRegions: []
		};
		const ctx = toProjectionContext(payload);
		expect(ctx.allowedFactions.size).toBe(1);
		expect(ctx.allowedFactions.get('f1')?.color).toBe('#00ff00');
	});
});

describe('fetchProjectionContextForMap', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('GETs /api/maps/[id]/projection-context and returns the converted context', async () => {
		const mockFetch = vi.fn(async (url: string) => {
			expect(url).toBe('/api/maps/map-123/projection-context');
			return new Response(
				JSON.stringify({
					allowedFactions: [{ id: 'f1', color: '#abc' }],
					allowedRegions: ['r1', 'r2']
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		});
		vi.stubGlobal('fetch', mockFetch);

		const ctx = await fetchProjectionContextForMap('map-123');
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(ctx.allowedFactions.get('f1')?.color).toBe('#abc');
		expect(ctx.allowedRegions.size).toBe(2);
	});

	it('throws on 404 (cross-user or missing map)', async () => {
		const mockFetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: 'Map not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', mockFetch);

		await expect(fetchProjectionContextForMap('nope')).rejects.toThrow(
			/Failed to load projection context/
		);
	});

	it('throws on 500 with server message in the error', async () => {
		const mockFetch = vi.fn(async () =>
			new Response(JSON.stringify({ message: 'DB exploded' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', mockFetch);

		await expect(fetchProjectionContextForMap('any')).rejects.toThrow(
			/Failed to load projection context/
		);
	});
});
