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
	// reset() intentionally preserves in-flight per-placement chains (Codex P2 —
	// see the reset-cancel test below), so it is NOT a cross-test isolation
	// mechanism: each test must settle the fetches it starts. We still call it to
	// clear the placement list before re-seeding.
	mapPlacements.reset();
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse([placement({ id: 'p1' })])) as unknown as typeof fetch;
	await mapPlacements.load({ locationId: 'loc-1' });
});

describe('mapPlacements.update — optimistic', () => {
	it('applies the payload to the store synchronously, before the PATCH resolves', async () => {
		// Held-open fetch so we can observe the store BEFORE the server responds,
		// then resolve it so the per-placement chain drains (reset() no longer
		// clears chains, so each test settles its own fetch — see beforeEach).
		let resolve!: (r: Response) => void;
		globalThis.fetch = vi.fn().mockReturnValue(
			new Promise<Response>((r) => { resolve = r; })
		) as unknown as typeof fetch;
		const pending = mapPlacements.update('p1', { data: { style: { color: '#abcdef' } } });
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({ style: { color: '#abcdef' } });
		resolve(makeResponse(placement({ id: 'p1', data: { style: { color: '#abcdef' } } })));
		await pending;
	});

	it('a second edit merges against the optimistic value (no dropped key)', async () => {
		// Two rapid edits before any PATCH resolves. The host (StyleEditor) reads
		// the store row as its merge base; the optimistic update keeps it current.
		const resolvers: Array<(r: Response) => void> = [];
		globalThis.fetch = vi.fn().mockReturnValue(
			new Promise<Response>((r) => { resolvers.push(r); })
		) as unknown as typeof fetch;
		const first = mapPlacements.update('p1', { data: { style: { color: '#abcdef' } } });
		// Simulate the host re-reading the live row and adding scale.
		const base = get(mapPlacements).find((p) => p.id === 'p1')!.data.style as Record<string, unknown>;
		const second = mapPlacements.update('p1', { data: { style: { ...base, scale: 2 } } });
		const row = get(mapPlacements).find((p) => p.id === 'p1');
		expect(row?.data).toEqual({ style: { color: '#abcdef', scale: 2 } });
		// Settle both so the chain drains and nothing leaks into later tests.
		resolvers.forEach((r) => r(makeResponse(placement({ id: 'p1', data: { style: { color: '#abcdef', scale: 2 } } }))));
		await Promise.allSettled([first, second]);
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

	it('reset() keeps gating a re-edit on the same placement after a context switch', async () => {
		// Codex P2: a PATCH is in flight when the user switches to a map with no
		// linked location (reset()), then returns and re-edits the SAME placement.
		// reset() must NOT drop the in-flight chain, or the re-edit's PATCH would
		// be sent unchained and a stale earlier request could reach the API last.
		const bodies: unknown[] = [];
		let resolveFirst!: () => void;
		const firstServer = placement({ id: 'p1', data: { style: { color: '#aaaaaa' } } });
		const secondServer = placement({ id: 'p1', data: { style: { color: '#bbbbbb' } } });
		globalThis.fetch = vi.fn((url: string, opts?: { body: string }) => {
			if (url.startsWith('/api/map-placements/')) {
				bodies.push(JSON.parse(opts!.body));
				if (bodies.length === 1) {
					return new Promise<Response>((res) => { resolveFirst = () => res(makeResponse(firstServer)); });
				}
				return Promise.resolve(makeResponse(secondServer));
			}
			return Promise.resolve(makeResponse([firstServer])); // any load()
		}) as unknown as typeof fetch;

		// First edit is in flight (held open).
		const first = mapPlacements.update('p1', { data: { style: { color: '#aaaaaa' } } });
		await tick();
		expect(bodies).toHaveLength(1);

		// Context switch: reset() then re-load the same placement back in.
		mapPlacements.reset();
		await mapPlacements.load({ locationId: 'loc-1' });

		// Re-edit the same placement. Its PATCH MUST stay queued behind the still
		// in-flight first one — proving reset() preserved the chain.
		const second = mapPlacements.update('p1', { data: { style: { color: '#bbbbbb' } } });
		await tick();
		expect(bodies).toHaveLength(1); // second still queued, NOT sent unchained

		resolveFirst();
		await first;
		await second;
		expect(bodies).toHaveLength(2); // second sent only after the first finished
	});
});
