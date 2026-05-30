// Slice 4 — mapPlacements store. Pins the optimistic update() behavior added
// to fix the Codex P2 data-loss race: the placement store was non-optimistic,
// so rapid multi-field StyleEditor edits re-derived from a stale row and
// dropped the earlier key. update() now applies the merge synchronously
// (before the PATCH resolves) and reverts on failure.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { mapPlacements } from '../../src/lib/stores/map-placements.js';
import type { MapPlacement } from '../../src/lib/types/map-placement.js';

function makeResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	} as unknown as Response;
}

function placement(partial: Partial<MapPlacement> & { id: string }): MapPlacement {
	return {
		placeableId: 'ent-1',
		locationId: 'loc-1',
		mapId: 'map-1',
		x: 0.5,
		y: 0.5,
		startActId: null,
		endActId: null,
		startSceneId: null,
		endSceneId: null,
		startPosition: null,
		endPosition: null,
		data: {},
		createdAt: 0,
		updatedAt: 0,
		...partial
	} as MapPlacement;
}

beforeEach(async () => {
	// Clear any in-flight update bookkeeping leaked by a prior test that fired
	// update() against a never-resolving fetch (the singleton store persists
	// across tests, so a pending PATCH chain would otherwise gate this test's
	// first update() and stall its fetch).
	mapPlacements.reset();
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([placement({ id: 'p1' })])) as unknown as typeof fetch;
	await mapPlacements.load({ locationId: 'loc-1' });
});

describe('mapPlacements.update — optimistic', () => {
	it('applies the payload to the store synchronously, before the PATCH resolves', () => {
		// Never-resolving fetch so we can observe the store BEFORE the server responds.
		globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>(() => {})) as unknown as typeof fetch;
		// Fire-and-don't-await: the optimistic merge must already be visible.
		void mapPlacements.update('p1', { data: { style: { color: '#abcdef' } } });
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({ style: { color: '#abcdef' } });
	});

	it('a second edit merges against the optimistic value (no dropped key)', () => {
		// Two rapid edits before any PATCH resolves. The host (StyleEditor) reads
		// the store row as its merge base; the optimistic update keeps it current.
		globalThis.fetch = vi.fn().mockReturnValue(new Promise<Response>(() => {})) as unknown as typeof fetch;
		void mapPlacements.update('p1', { data: { style: { color: '#abcdef' } } });
		// Simulate the host re-reading the live row and adding scale.
		const base = get(mapPlacements).find((p) => p.id === 'p1')!.data.style as Record<string, unknown>;
		void mapPlacements.update('p1', { data: { style: { ...base, scale: 2 } } });
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({ style: { color: '#abcdef', scale: 2 } });
	});

	it('reverts the optimistic change when the PATCH fails', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse('bad', false, 400)) as unknown as typeof fetch;
		await expect(mapPlacements.update('p1', { data: { style: { color: '#abcdef' } } })).rejects.toThrow();
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({}); // reverted to the pre-edit row
	});

	it('replaces the optimistic row with the server response on success', async () => {
		const server = placement({ id: 'p1', data: { style: { color: '#111111' } }, x: 0.9 });
		globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(server)) as unknown as typeof fetch;
		await mapPlacements.update('p1', { data: { style: { color: '#abcdef' } } });
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row).toEqual(server);
	});
});

describe('mapPlacements.update — per-placement PATCH serialization (Codex P2)', () => {
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('does not send the second PATCH until the first resolves (in-order on the wire)', async () => {
		// Two rapid edits to p1. The first PATCH is held open; the second must
		// NOT hit the API until the first completes, so the server can never
		// receive them out of order (which would persist the older data).
		const bodies: unknown[] = [];
		let resolveFirst!: () => void;
		const firstServer = placement({ id: 'p1', data: { style: { color: '#aaaaaa' } } });
		const secondServer = placement({ id: 'p1', data: { style: { color: '#aaaaaa', scale: 2 } } });
		globalThis.fetch = vi.fn((_url: string, opts: { body: string }) => {
			bodies.push(JSON.parse(opts.body));
			if (bodies.length === 1) {
				return new Promise<Response>((res) => {
					resolveFirst = () => res(makeResponse(firstServer));
				});
			}
			return Promise.resolve(makeResponse(secondServer));
		}) as unknown as typeof fetch;

		const first = mapPlacements.update('p1', { data: { style: { color: '#aaaaaa' } } });
		const second = mapPlacements.update('p1', { data: { style: { color: '#aaaaaa', scale: 2 } } });

		await tick();
		expect(bodies).toHaveLength(1); // second PATCH is queued, not yet sent

		resolveFirst();
		await first;
		await second;

		expect(bodies).toHaveLength(2); // second sent only after the first finished
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({ style: { color: '#aaaaaa', scale: 2 } });
	});

	it('a failed earlier PATCH does not block or revert a newer queued edit', async () => {
		const secondServer = placement({ id: 'p1', data: { style: { color: '#bbbbbb' } } });
		let rejectFirst!: () => void;
		const bodies: unknown[] = [];
		globalThis.fetch = vi.fn((_url: string, opts: { body: string }) => {
			bodies.push(JSON.parse(opts.body));
			if (bodies.length === 1) {
				return new Promise<Response>((_res, rej) => {
					rejectFirst = () => rej(new Error('boom'));
				});
			}
			return Promise.resolve(makeResponse(secondServer));
		}) as unknown as typeof fetch;

		const first = mapPlacements.update('p1', { data: { style: { color: '#aaaaaa' } } });
		const second = mapPlacements.update('p1', { data: { style: { color: '#bbbbbb' } } });

		await tick();
		rejectFirst();
		await expect(first).rejects.toThrow();
		await second;

		// The newer edit still ran (after the failed one drained) and its value
		// stands — the failed earlier PATCH neither reverted nor blocked it.
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({ style: { color: '#bbbbbb' } });
	});
});
