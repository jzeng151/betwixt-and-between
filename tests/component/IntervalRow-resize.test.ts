import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntervalRow from '$lib/features/timeline/IntervalRow.svelte';
import type { Interval } from '$lib/features/timeline/intervals-store.js';
import type { Entity } from '$lib/stores/entities.js';

beforeEach(cleanup);

describe('IntervalRow resize handles', () => {
	it('partitions narrow hit targets and exposes slider values', () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const interval = {
			id: 'interval-1',
			entityId: 'character-1',
			startActId: act.id,
			endActId: act.id,
			startSceneId: null,
			endSceneId: null,
			startPosition: 0.2,
			endPosition: 0.4
		} as Interval;
		const { getAllByRole } = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval],
				idx: 0,
				trackWidthPx: 100,
				actCount: 1,
				acts: [act],
				scenesByActId: new Map(),
				colorFor: () => '#c8942a',
				dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval',
				posToFrac: (position: number) => position,
				fracToPos: (fraction: number) => fraction,
				pxForRange: () => 10,
				onLockAcquire: vi.fn(),
				onLockRelease: vi.fn(),
				onError: vi.fn()
			}
		});
		const [start, end] = getAllByRole('slider');

		expect(start).toHaveAttribute('aria-valuenow', '0.2');
		expect(end).toHaveAttribute('aria-valuenow', '0.4');
		expect(start).toHaveStyle({ clipPath: 'inset(0 7px 0 0)' });
		expect(end).toHaveStyle({ clipPath: 'inset(0 0 0 7px)' });
	});

	it('shrinks a whole-act interval from the keyboard', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const interval = {
			id: 'interval-1',
			entityId: 'character-1',
			startActId: act.id,
			endActId: act.id,
			startSceneId: null,
			endSceneId: null,
			startPosition: 0,
			endPosition: 1
		} as Interval;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => interval
		}) as unknown as typeof fetch;
		const { getAllByRole } = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map(), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval', posToFrac: (value: number) => value,
				fracToPos: (value: number) => value, pxForRange: () => 100,
				onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});

		await fireEvent.keyDown(getAllByRole('slider')[0], { key: 'ArrowRight' });

		expect(globalThis.fetch).toHaveBeenCalledWith('/api/intervals/interval-1',
			expect.objectContaining({ body: expect.stringContaining('"startPosition":0.1') }));
	});
});
