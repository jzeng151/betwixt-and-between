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
			json: async () => ({ ...interval, startPosition: 0.1 })
		}) as unknown as typeof fetch;
		const { getAllByRole, container } = render(IntervalRow, {
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

		expect(container.querySelector('.bar-wrapper')).toHaveStyle({ left: '10%' });
		expect(globalThis.fetch).toHaveBeenCalledWith('/api/intervals/interval-1',
			expect.objectContaining({ body: expect.stringContaining('"startPosition":0.1') }));
	});

	it('leaves modified resize arrows to the browser', () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 1
		} as Interval;
		globalThis.fetch = vi.fn();
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map(), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval', posToFrac: (value: number) => value,
				fracToPos: (value: number) => value, pxForRange: () => 100,
				onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});
		const slider = view.getAllByRole('slider')[0];

		for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
			const event = new KeyboardEvent('keydown', {
				key: 'ArrowRight', bubbles: true, cancelable: true, ...modifier
			});
			slider.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(globalThis.fetch).not.toHaveBeenCalled();
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
		const onLockAcquire = vi.fn();
		const onLockRelease = vi.fn();
		const { getAllByRole } = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map(), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval', posToFrac: (value: number) => value,
				fracToPos: (value: number) => value, pxForRange: () => 100,
				onLockAcquire, onLockRelease, onError: vi.fn()
			}
		});
		const [start, end] = getAllByRole('slider');

		await fireEvent.keyDown(start, { key: 'ArrowRight' });
		await fireEvent.keyDown(end, { key: 'ArrowLeft' });
		await fireEvent.keyDown(start, { key: 'ArrowRight' });
		await waitFor(() => expect(start).toHaveAttribute('aria-valuenow', '0.2'));
		expect(end).toHaveAttribute('aria-valuenow', '0.9');
		expect(start).toHaveAttribute('aria-valuemax', '0.8');
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(onLockAcquire).toHaveBeenCalledOnce();
		expect(onLockRelease).not.toHaveBeenCalled();
		expect(fetchMock.mock.calls[0][1].body).toContain('"startPosition":0.1');
		resolveFirst({ ok: true, json: async () => ({ ...interval, startPosition: 0.1 }) } as Response);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls[1][1].body).toContain('"startPosition":0.2');
		expect(fetchMock.mock.calls[1][1].body).toContain('"endPosition":0.9');
		await waitFor(() => expect(onLockRelease).toHaveBeenCalledOnce());
	});

	it('rebases a queued resize on an overlap-merged response', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 0.5
		} as Interval;
		let resolveFirst!: (response: Response) => void;
		const fetchMock = vi.fn()
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveFirst = resolve; }))
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ...interval, endPosition: 1 }) });
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map(), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval', posToFrac: (value: number) => value,
				fracToPos: (value: number) => value, pxForRange: () => 100,
				onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});
		const end = view.getAllByRole('slider')[1];

		await fireEvent.keyDown(end, { key: 'ArrowRight' });
		await fireEvent.keyDown(end, { key: 'ArrowRight' });
		resolveFirst({ ok: true, json: async () => ({ ...interval, endPosition: 0.9, absorbed: ['sibling'] }) } as Response);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

		expect(fetchMock.mock.calls[1][1].body).toContain('"endPosition":1');
	});

	it('blocks splits across the row while a keyboard resize is pending', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const scenes = [
			{ id: 'scene-1', type: 'Scene', name: 'Opening', parentId: act.id },
			{ id: 'scene-2', type: 'Scene', name: 'Turn', parentId: act.id }
		] as Entity[];
		const intervals = [
			{ id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
				startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 0.3 },
			{ id: 'interval-2', entityId: 'character-1', startActId: act.id, endActId: act.id,
				startSceneId: null, endSceneId: null, startPosition: 0.4, endPosition: 1 }
		] as Interval[];
		let resolveResize!: (response: Response) => void;
		const fetchMock = vi.fn().mockReturnValueOnce(
			new Promise<Response>((resolve) => { resolveResize = resolve; })
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals, idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map([[act.id, scenes]]), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval', posToFrac: (value: number) => value,
				fracToPos: (value: number) => value, pxForRange: () => 40,
				onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});

		await fireEvent.keyDown(view.getAllByRole('slider')[0], { key: 'ArrowRight' });
		await fireEvent.click(
			view.container.querySelectorAll<HTMLElement>('[data-interval-id]')[1]
				.querySelector<HTMLButtonElement>('.hairline-hit')!
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		resolveResize({ ok: true, json: async () => intervals[0] } as Response);
		await waitFor(() => expect(view.getAllByRole('slider')[0]).toHaveAttribute('aria-valuenow', '0'));

		let resolveSplit!: (response: Response) => void;
		const splitFetch = vi.fn()
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveSplit = resolve; }))
			.mockResolvedValueOnce({ ok: true, json: async () => intervals });
		globalThis.fetch = splitFetch as unknown as typeof fetch;
		await fireEvent.click(
			view.container.querySelectorAll<HTMLElement>('[data-interval-id]')[1]
				.querySelector<HTMLButtonElement>('.hairline-hit')!
		);
		await fireEvent.keyDown(view.getAllByRole('slider')[0], { key: 'ArrowRight' });
		expect(splitFetch).toHaveBeenCalledOnce();
		resolveSplit({ ok: true } as Response);
		await waitFor(() => expect(splitFetch).toHaveBeenCalledTimes(2));
	});

	it('keeps resize and translation pointer writes mutually exclusive', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'Act One' } as Entity;
		const scenes = [
			{ id: 'scene-1', type: 'Scene', name: 'Opening', parentId: act.id },
			{ id: 'scene-2', type: 'Scene', name: 'Turn', parentId: act.id }
		] as Entity[];
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 1
		} as Interval;
		const resolvers: Array<(response: Response) => void> = [];
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const onLockAcquire = vi.fn();
		const onLockRelease = vi.fn();
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map([[act.id, scenes]]), colorFor: () => '#c8942a', dataNoteSnippet: () => null,
				tooltipFor: () => 'Mara interval', posToFrac: (value: number) => value,
				fracToPos: (value: number) => value, pxForRange: () => 100,
				onLockAcquire, onLockRelease, onError: vi.fn()
			}
		});
		const start = view.getAllByRole('slider')[0];
		const split = view.getByRole('button', { name: /Split interval at 50%/ });
		const bar = view.container.querySelector<HTMLElement>('.bar-wrapper')!;
		bar.setPointerCapture = vi.fn();
		bar.releasePointerCapture = vi.fn();

		await fireEvent.pointerDown(start, { pointerId: 1, clientX: 0 });
		await fireEvent.keyDown(start, { key: 'ArrowRight' });
		expect(fetchMock).not.toHaveBeenCalled();
		await fireEvent.pointerMove(window, { pointerId: 1, clientX: 10 });
		await fireEvent.pointerUp(window, { pointerId: 1, clientX: 10 });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await fireEvent.pointerDown(start, { pointerId: 2, clientX: 10 });
		await fireEvent.pointerDown(bar, { pointerId: 2, button: 0, clientX: 10 });
		await fireEvent.click(split);
		expect(onLockAcquire).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledOnce();
		resolvers[0]({ ok: true, json: async () => ({ ...interval, startPosition: 0.1 }) } as Response);
		await waitFor(() => expect(bar).not.toHaveClass('resizing'));

		await fireEvent.pointerDown(bar, { pointerId: 3, button: 0, clientX: 10 });
		expect(onLockAcquire).toHaveBeenCalledTimes(2);
		await fireEvent.pointerMove(bar, { pointerId: 3, button: 0, clientX: 20 });
		await fireEvent.pointerUp(bar, { pointerId: 3, button: 0, clientX: 20 });
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await fireEvent.pointerDown(start, { pointerId: 4, clientX: 20 });
		await fireEvent.keyDown(start, { key: 'ArrowRight' });
		await fireEvent.pointerDown(bar, { pointerId: 5, button: 0, clientX: 20 });
		await fireEvent.click(split);
		expect(onLockAcquire).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		resolvers[1]({ ok: true, json: async () => interval } as Response);
		await waitFor(() => expect(onLockRelease).toHaveBeenCalledTimes(2));
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

		const split = getByRole('button', { name: /Split interval at 50%/ });
		split.focus();
		await fireEvent.keyDown(split, { key: 'Enter' });

		await waitFor(() => expect(getByRole('button', { name: 'Mara interval' })).toHaveFocus());
	});

	it('ignores repeated split activation while the first request is pending', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'One' } as Entity;
		const scenes = [
			{ id: 'scene-1', type: 'Scene', name: 'Opening', parentId: act.id },
			{ id: 'scene-2', type: 'Scene', name: 'Turn', parentId: act.id }
		] as Entity[];
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 1
		} as Interval;
		let resolveSplit!: (response: Response) => void;
		const fetchMock = vi.fn()
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveSplit = resolve; }))
			.mockResolvedValueOnce({ ok: true, json: async () => [interval] });
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map([[act.id, scenes]]), colorFor: () => '#c8942a',
				dataNoteSnippet: () => null, tooltipFor: () => 'Mara interval',
				posToFrac: (value: number) => value, fracToPos: (value: number) => value,
				pxForRange: () => 100, onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});
		const split = view.getByRole('button', { name: /Split interval at 50%/ });

		await fireEvent.keyDown(split, { key: 'Enter' });
		await fireEvent.keyDown(split, { key: 'Enter' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveSplit({ ok: true } as Response);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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

	it('preserves a deliberate focus change while a split completes', async () => {
		const act = { id: 'act-1', type: 'Act', name: 'One' } as Entity;
		const scenes = [
			{ id: 'scene-1', type: 'Scene', name: 'Opening', parentId: act.id },
			{ id: 'scene-2', type: 'Scene', name: 'Turn', parentId: act.id }
		] as Entity[];
		const interval = {
			id: 'interval-1', entityId: 'character-1', startActId: act.id, endActId: act.id,
			startSceneId: null, endSceneId: null, startPosition: 0, endPosition: 1
		} as Interval;
		let resolveSplit!: (response: Response) => void;
		globalThis.fetch = vi.fn()
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveSplit = resolve; }))
			.mockResolvedValueOnce({ ok: true, json: async () => [interval] }) as unknown as typeof fetch;
		const view = render(IntervalRow, {
			props: {
				entity: { id: 'character-1', type: 'Character', name: 'Mara' } as Entity,
				intervals: [interval], idx: 0, trackWidthPx: 100, actCount: 1, acts: [act],
				scenesByActId: new Map([[act.id, scenes]]), colorFor: () => '#c8942a',
				dataNoteSnippet: () => null, tooltipFor: () => 'Mara interval',
				posToFrac: (value: number) => value, fracToPos: (value: number) => value,
				pxForRange: () => 100, onLockAcquire: vi.fn(), onLockRelease: vi.fn(), onError: vi.fn()
			}
		});
		const split = view.getByRole('button', { name: /Split interval at 50%/ });
		const elsewhere = document.body.appendChild(document.createElement('button'));
		split.focus();
		await fireEvent.keyDown(split, { key: 'Enter' });
		elsewhere.focus();
		resolveSplit({ ok: true } as Response);

		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
		expect(elsewhere).toHaveFocus();
		elsewhere.remove();
	});
});
