// Pins the refreshTimelineStores contract: both store loads kick off in
// parallel, and the helper does not resolve until BOTH have settled. Six
// call sites across Timeline.svelte and ActsHeader.svelte depend on this
// shape after mutations — a future "simplification" to sequential awaits
// would silently double the post-mutation latency.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/stores/entities.js', () => ({
	entities: { load: vi.fn() }
}));
vi.mock('$lib/features/timeline/intervals-store.js', () => ({
	intervals: { load: vi.fn() }
}));

import { entities } from '$lib/stores/entities.js';
import { intervals } from '$lib/features/timeline/intervals-store.js';
import { refreshTimelineStores } from '../../src/lib/features/timeline/loaders.js';

describe('refreshTimelineStores', () => {
	it('kicks off both store loads in parallel and resolves once both settle', async () => {
		let resolveEntities!: () => void;
		let resolveIntervals!: () => void;
		(entities.load as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise<void>((r) => {
				resolveEntities = r;
			})
		);
		(intervals.load as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise<void>((r) => {
				resolveIntervals = r;
			})
		);

		const settled = vi.fn();
		const p = refreshTimelineStores().then(settled);

		// Both should have been kicked off synchronously.
		expect(entities.load).toHaveBeenCalledTimes(1);
		expect(intervals.load).toHaveBeenCalledTimes(1);

		// Resolving only one is not enough.
		resolveEntities();
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();

		// After both, the helper resolves.
		resolveIntervals();
		await p;
		expect(settled).toHaveBeenCalledTimes(1);
	});
});
