import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { intervals, type Interval } from '../../src/lib/stores/intervals.js';

function mkInterval(overrides: Partial<Interval> = {}): Interval {
	return {
		id: 'i1',
		entityId: 'ent1',
		startActId: 'act1',
		startSceneId: null,
		endActId: 'act1',
		endSceneId: null,
		startPosition: 1.0,
		endPosition: 2.0,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

function mkResponse(body: unknown, ok = true, status = 200) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' }
		}) as Response
	) as unknown as ReturnType<typeof fetch>;
}

describe('intervals store', () => {
	beforeEach(async () => {
		// Reset to empty before each test by mocking a load
		globalThis.fetch = vi.fn(() => mkResponse([])) as unknown as typeof fetch;
		await intervals.load();
		vi.restoreAllMocks();
	});

	it('load() populates the store from /api/intervals', async () => {
		const fixture = [mkInterval({ id: 'a' }), mkInterval({ id: 'b', entityId: 'ent2' })];
		globalThis.fetch = vi.fn(() => mkResponse(fixture)) as unknown as typeof fetch;

		await intervals.load();
		expect(get(intervals)).toEqual(fixture);
	});

	it('createInterval() POSTs and appends optimistically', async () => {
		const fetchSpy = vi.fn(() => mkResponse(mkInterval({ id: 'new' }), true, 201));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const before = get(intervals).length;
		const created = await intervals.createInterval({
			entityId: 'ent1',
			startActId: 'act1',
			endActId: 'act1'
		});
		expect(created.id).toBe('new');
		expect(get(intervals).length).toBe(before + 1);
		expect(fetchSpy).toHaveBeenCalledWith(
			'/api/intervals',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ 'Content-Type': 'application/json' })
			})
		);
	});

	it('createInterval() throws and does not append on server error', async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(new Response('400 bad request', { status: 400 }) as Response)
		) as unknown as typeof fetch;

		const before = get(intervals).length;
		await expect(
			intervals.createInterval({ entityId: 'ent1', startActId: 'act1', endActId: 'act1' })
		).rejects.toThrow();
		expect(get(intervals).length).toBe(before);
	});

	it('updateInterval() PATCHes and replaces the row', async () => {
		// Seed
		globalThis.fetch = vi.fn(() => mkResponse([mkInterval({ id: 'a', endPosition: 2.0 })])) as unknown as typeof fetch;
		await intervals.load();

		// Now patch
		const updated = mkInterval({ id: 'a', endPosition: 3.0 });
		globalThis.fetch = vi.fn(() => mkResponse(updated)) as unknown as typeof fetch;
		const result = await intervals.updateInterval('a', { endActId: 'act2' });

		expect(result.endPosition).toBeCloseTo(3.0);
		const all = get(intervals);
		expect(all).toHaveLength(1);
		expect(all[0].endPosition).toBeCloseTo(3.0);
	});

	it('deleteInterval() optimistically removes the row, calls DELETE', async () => {
		globalThis.fetch = vi.fn(() =>
			mkResponse([mkInterval({ id: 'a' }), mkInterval({ id: 'b' })])
		) as unknown as typeof fetch;
		await intervals.load();
		expect(get(intervals).length).toBe(2);

		const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 }) as Response));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await intervals.deleteInterval('a');
		expect(get(intervals).length).toBe(1);
		expect(get(intervals)[0].id).toBe('b');
		expect(fetchSpy).toHaveBeenCalledWith(
			'/api/intervals/a',
			expect.objectContaining({ method: 'DELETE' })
		);
	});

	it('deleteInterval() rolls back via load() on server error', async () => {
		// Seed with two rows
		const fixture = [mkInterval({ id: 'a' }), mkInterval({ id: 'b' })];
		globalThis.fetch = vi.fn(() => mkResponse(fixture)) as unknown as typeof fetch;
		await intervals.load();
		expect(get(intervals).length).toBe(2);

		// DELETE fails, then the rollback load() returns the original two
		let callCount = 0;
		globalThis.fetch = vi.fn(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve(new Response('boom', { status: 500 }) as Response);
			}
			return mkResponse(fixture);
		}) as unknown as typeof fetch;

		await expect(intervals.deleteInterval('a')).rejects.toThrow();
		// After rollback, both rows are back
		expect(get(intervals).length).toBe(2);
	});
});
