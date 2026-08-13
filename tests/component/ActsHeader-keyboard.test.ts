import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActsHeader from '$lib/features/timeline/ActsHeader.svelte';
import type { Entity } from '$lib/stores/entities.js';

beforeEach(cleanup);

describe('ActsHeader keyboard controls', () => {
	it('selects story units and resizes acts without a pointer', async () => {
		const acts = [
			{ id: 'act-1', type: 'Act', name: 'Act One' },
			{ id: 'act-2', type: 'Act', name: 'Act Two' }
		] as Entity[];
		const scene = { id: 'scene-1', type: 'Scene', name: 'Opening', parentId: 'act-1' } as Entity;
		const onSelectAct = vi.fn();
		const onSelectScene = vi.fn();
		const onWeightPreview = vi.fn();
		const onWeightCommit = vi.fn();
		const { getByRole } = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map([['act-1', [scene]], ['act-2', []]]),
				weights: [1, 1],
				trackWidthPx: 600,
				onSelectAct,
				onSelectScene,
				onWeightPreview,
				onWeightCommit
			}
		});

		await fireEvent.click(getByRole('button', { name: 'Act One' }));
		await fireEvent.keyDown(getByRole('button', { name: /Select Opening/ }), { key: ' ' });
		const slider = getByRole('slider', { name: /Width of Act One/ });
		await fireEvent.keyDown(slider, { key: 'ArrowRight' });

		expect(onSelectAct).toHaveBeenCalledWith('act-1');
		expect(onSelectScene).toHaveBeenCalledWith('scene-1');
		expect(onWeightPreview).toHaveBeenCalledOnce();
		expect(onWeightCommit).toHaveBeenCalledOnce();
		expect(slider).toHaveAttribute('aria-valuemin', '10');
		expect(slider).toHaveAttribute('aria-valuemax', '90');
	});

	it('serializes repeated act and scene moves from their requested positions', async () => {
		const acts = ['One', 'Two', 'Three'].map((name, index) => ({
			id: `act-${index + 1}`, type: 'Act', name
		})) as Entity[];
		const scene = { id: 'scene-1', type: 'Scene', name: 'Opening', parentId: 'act-1' } as Entity;
		const patches: Array<Record<string, unknown>> = [];
		globalThis.fetch = vi.fn(async (_url, options) => {
			if (options?.method === 'PATCH') patches.push(JSON.parse(String(options.body)));
			return { ok: true, json: async () => [] } as Response;
		}) as unknown as typeof fetch;
		const view = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map([['act-1', [scene]], ['act-2', []], ['act-3', []]]),
				weights: [1, 1, 1],
				trackWidthPx: 600
			}
		});

		const actGrip = view.getByRole('slider', { name: /Reorder One/ });
		await fireEvent.keyDown(actGrip, { key: 'ArrowRight' });
		await fireEvent.keyDown(actGrip, { key: 'ArrowRight' });
		const sceneCell = view.getByRole('button', { name: /Select Opening/ });
		await fireEvent.keyDown(sceneCell, { key: 'ArrowDown', altKey: true });
		await fireEvent.keyDown(sceneCell, { key: 'ArrowDown', altKey: true });

		await waitFor(() => expect(patches).toHaveLength(4));
		expect(patches.filter((patch) => !('parentId' in patch))).toEqual([
			{ position: 1 }, { position: 2 }
		]);
		expect(patches.filter((patch) => 'parentId' in patch)).toEqual([
			{ parentId: 'act-2', position: 0 }, { parentId: 'act-3', position: 0 }
		]);
	});

	it('derives queued keyboard moves from the optimistic act order', async () => {
		const acts = ['One', 'Two', 'Three'].map((name, index) => ({
			id: `act-${index + 1}`, type: 'Act', name
		})) as Entity[];
		const patchResolvers: Array<(response: Response) => void> = [];
		const patches: Array<Record<string, unknown>> = [];
		const fetchMock = vi.fn((_url, options) => {
			if (options?.method !== 'PATCH') return Promise.resolve({ ok: true, json: async () => [] } as Response);
			patches.push(JSON.parse(String(options.body)));
			return new Promise<Response>((resolve) => patchResolvers.push(resolve));
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const view = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map(),
				weights: [1, 1, 1],
				trackWidthPx: 600
			}
		});

		await fireEvent.keyDown(view.getByRole('slider', { name: /Reorder One/ }), { key: 'ArrowRight' });
		expect(view.getByRole('slider', { name: /Reorder One/ })).toHaveAttribute('aria-valuenow', '2');
		await fireEvent.keyDown(view.getByRole('slider', { name: /Reorder Two/ }), { key: 'ArrowRight' });
		await waitFor(() => expect(patchResolvers).toHaveLength(1));
		patchResolvers[0]({ ok: true, json: async () => ({}) } as Response);
		await waitFor(() => expect(patchResolvers).toHaveLength(2));
		expect(patches).toEqual([{ position: 1 }, { position: 1 }]);
		patchResolvers[1]({ ok: true, json: async () => ({}) } as Response);
	});

	it('captures a queued scene move destination before act order changes', async () => {
		const acts = [
			{ id: 'act-1', type: 'Act', name: 'One' },
			{ id: 'act-2', type: 'Act', name: 'Two' }
		] as Entity[];
		const scene = { id: 'scene-1', type: 'Scene', name: 'Opening', parentId: 'act-1' } as Entity;
		let resolveFirst!: (response: Response) => void;
		const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
		globalThis.fetch = vi.fn((url, options) => {
			if (options?.method !== 'PATCH') return Promise.resolve({ ok: true, json: async () => [] } as Response);
			patches.push({ url: String(url), body: JSON.parse(String(options.body)) });
			if (patches.length === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve; });
			return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
		}) as unknown as typeof fetch;
		const view = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map([['act-1', [scene]], ['act-2', []]]),
				weights: [1, 1],
				trackWidthPx: 600
			}
		});

		await fireEvent.keyDown(view.getByRole('slider', { name: /Reorder One/ }), { key: 'ArrowRight' });
		await fireEvent.keyDown(view.getByRole('button', { name: /Select Opening/ }), { key: 'ArrowDown', altKey: true });
		resolveFirst({ ok: true, json: async () => ({}) } as Response);
		await waitFor(() => expect(patches).toHaveLength(2));

		expect(patches[1].body).toEqual({ parentId: 'act-2', position: 0 });
	});

	it('serializes sibling scene moves from one optimistic order', async () => {
		const acts = [{ id: 'act-1', type: 'Act', name: 'One' }] as Entity[];
		const scenes = ['A', 'B', 'C'].map((name, index) => ({
			id: `scene-${index + 1}`, type: 'Scene', name, parentId: 'act-1'
		})) as Entity[];
		const patchResolvers: Array<(response: Response) => void> = [];
		const patches: Array<Record<string, unknown>> = [];
		globalThis.fetch = vi.fn((_url, options) => {
			if (options?.method !== 'PATCH') return Promise.resolve({ ok: true, json: async () => [] } as Response);
			patches.push(JSON.parse(String(options.body)));
			return new Promise<Response>((resolve) => patchResolvers.push(resolve));
		}) as unknown as typeof fetch;
		const view = render(ActsHeader, {
			props: { acts, scenesByActId: new Map([['act-1', scenes]]), weights: [1], trackWidthPx: 600 }
		});

		await fireEvent.keyDown(view.getByRole('button', { name: /Select A/ }), { key: 'ArrowRight', altKey: true });
		await fireEvent.keyDown(view.getByRole('button', { name: /Select B/ }), { key: 'ArrowRight', altKey: true });
		await waitFor(() => expect(patchResolvers).toHaveLength(1));
		patchResolvers[0]({ ok: true, json: async () => ({}) } as Response);
		await waitFor(() => expect(patchResolvers).toHaveLength(2));
		expect(patches).toEqual([
			{ parentId: 'act-1', position: 1 },
			{ parentId: 'act-1', position: 1 }
		]);
		patchResolvers[1]({ ok: true, json: async () => ({}) } as Response);
	});

	it('lets an undersized act recover and keeps its ARIA value in range', async () => {
		const acts = [
			{ id: 'act-1', type: 'Act', name: 'One' },
			{ id: 'act-2', type: 'Act', name: 'Two' },
			{ id: 'act-3', type: 'Act', name: 'Three' }
		] as Entity[];
		const onWeightCommit = vi.fn();
		const view = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map(),
				weights: [0.1, 1.9, 1],
				trackWidthPx: 600,
				onWeightCommit
			}
		});
		const slider = view.getByRole('slider', { name: /Width of One/ });

		await fireEvent.keyDown(slider, { key: 'ArrowRight' });

		const committed = onWeightCommit.mock.calls[0][0];
		expect(committed['act-1']).toBeCloseTo(0.3);
		expect(committed['act-2']).toBeCloseTo(1.7);
		expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
			Number(slider.getAttribute('aria-valuemin'))
		);
		expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
			Number(slider.getAttribute('aria-valuemax'))
		);
	});

	it('hides width sliders when the minimum widths cannot fit', () => {
		const acts = Array.from({ length: 12 }, (_, index) => ({
			id: `act-${index}`, type: 'Act', name: `Act ${index + 1}`
		})) as Entity[];
		const view = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map(),
				weights: acts.map(() => 1),
				trackWidthPx: 700
			}
		});

		expect(view.queryAllByRole('slider', { name: /Width of/ })).toHaveLength(0);
	});

	it('does not restore scene focus after the user moves elsewhere', async () => {
		const acts = [
			{ id: 'act-1', type: 'Act', name: 'One' },
			{ id: 'act-2', type: 'Act', name: 'Two' }
		] as Entity[];
		const scene = { id: 'scene-1', type: 'Scene', name: 'Opening', parentId: 'act-1' } as Entity;
		let resolvePatch!: (response: Response) => void;
		const fetchMock = vi.fn((_url, options) => options?.method === 'PATCH'
			? new Promise<Response>((resolve) => { resolvePatch = resolve; })
			: Promise.resolve({ ok: true, json: async () => [] } as Response)
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const view = render(ActsHeader, {
			props: {
				acts,
				scenesByActId: new Map([['act-1', [scene]], ['act-2', []]]),
				weights: [1, 1],
				trackWidthPx: 600
			}
		});
		const sceneCell = view.getByRole('button', { name: /Select Opening/ });
		const other = view.getByRole('button', { name: 'Two' });
		sceneCell.focus();
		await fireEvent.keyDown(sceneCell, { key: 'ArrowDown', altKey: true });
		other.focus();
		resolvePatch({ ok: true, json: async () => ({}) } as Response);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(other).toHaveFocus();
	});
});
