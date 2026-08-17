// Pins the refreshTimelineStores contract: each entity/interval pair loads in
// parallel, while overlapping mutation refreshes run in submission order.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/stores/entities.js', () => ({
	entities: { refreshAfterMutation: vi.fn() }
}));
vi.mock('$lib/features/timeline/intervals-store.js', () => ({
	intervals: { load: vi.fn() }
}));

import { entities } from '$lib/stores/entities.js';
import { intervals } from '$lib/features/timeline/intervals-store.js';
import { refreshTimelineStores } from '../../src/lib/features/timeline/loaders.js';

describe('refreshTimelineStores', () => {
	it('runs each load pair in parallel and serializes overlapping refreshes', async () => {
		let resolveEntities!: () => void;
		let resolveIntervals!: () => void;
		(entities.refreshAfterMutation as ReturnType<typeof vi.fn>).mockReturnValue(
			new Promise<void>((r) => {
				resolveEntities = r;
			})
		);
		(intervals.load as ReturnType<typeof vi.fn>).mockReturnValue(
			new Promise<void>((r) => {
				resolveIntervals = r;
			})
		);

		const first = refreshTimelineStores();
		const second = refreshTimelineStores();
		await Promise.resolve();

		expect(entities.refreshAfterMutation).toHaveBeenCalledTimes(1);
		expect(intervals.load).toHaveBeenCalledTimes(1);

		// Resolving only one is not enough.
		resolveEntities();
		resolveIntervals();
		await first;
		await Promise.resolve();
		expect(entities.refreshAfterMutation).toHaveBeenCalledTimes(2);
		expect(intervals.load).toHaveBeenCalledTimes(2);

		resolveEntities();
		resolveIntervals();
		await second;
	});
});
