import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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
		expect(start).toHaveAttribute('aria-valuemax', '0.3');
		expect(end).toHaveAttribute('aria-valuenow', '0.4');
		expect(end).toHaveAttribute('aria-valuemin', '0.3');
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

	it('serializes repeated resize keys from the requested position', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 1
		} as Interval;
		let resolveFirst!: (response: Response) => void;
		const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
		const fetchMock = vi.fn()
			.mockReturnValueOnce(first)
			.mockResolvedValue({ ok: true, json: async () => ({ ...interval, startPosition: 0.2 }) });
		globalThis.fetch = fetchMock as unknown as typeof fetch;
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
		const start = getAllByRole('slider')[0];

		await fireEvent.keyDown(start, { key: 'ArrowRight' });
		await fireEvent.keyDown(start, { key: 'ArrowRight' });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock.mock.calls[0][1].body).toContain('"startPosition":0.1');
		resolveFirst({ ok: true, json: async () => ({ ...interval, startPosition: 0.1 }) } as Response);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls[1][1].body).toContain('"startPosition":0.2');
	});

	it('returns focus to the interval after a keyboard split', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const scenes = [
			{ id: 'scene-1', type: 'Scene', name: 'Opening', parentId: act.id },
			{ id: 'scene-2', type: 'Scene', name: 'Turn', parentId: act.id }
		] as Entity[];
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 1
		} as Interval;
		globalThis.fetch = vi.fn()
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: async () => [interval] }) as unknown as typeof fetch;
		const { getByRole } = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map([[act.id, scenes]]), colorFor: () => '#c8942a',
				dataNoteSnippet: () => null, tooltipFor: () => 'Mara interval',
				posToFrac: (value: number) => value, fracToPos: (value: number) => value,
				pxForRange: () => 100, onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});

		await fireEvent.keyDown(getByRole('button', { name: /Split interval at 50%/ }), { key: 'Enter' });

		await waitFor(() => expect(getByRole('button', { name: 'Mara interval' })).toHaveFocus());
	});

	it('converts rendered split fractions back through the weighted timeline', async () => {
		const acts = [
			{ id: 'act-1', type: 'Act', name: 'One' },
			{ id: 'act-2', type: 'Act', name: 'Two' }
		] as Entity[];
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: 'act-1', endActId: 'act-2',
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 2
		} as Interval;
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: async () => [interval] });
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 400, actCount: 2, acts,
				scenesByActId: new Map(), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval',
				posToFrac: (position: number) => position <= 1 ? position * 0.25 : 0.25 + (position - 1) * 0.75,
				fracToPos: (fraction: number) => fraction <= 0.25 ? fraction / 0.25 : 1 + (fraction - 0.25) / 0.75,
				pxForRange: () => 400, onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});

		await fireEvent.keyDown(view.getByRole('button', { name: /Split interval at 25%/ }), { key: 'Enter' });

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ atPosition: 1 });
	});
});
