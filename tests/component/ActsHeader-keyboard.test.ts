import { cleanup, fireEvent, render } from '@testing-library/svelte';
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
		await fireEvent.keyDown(getByRole('slider'), { key: 'ArrowRight' });

		expect(onSelectAct).toHaveBeenCalledWith('act-1');
		expect(onSelectScene).toHaveBeenCalledWith('scene-1');
		expect(onWeightPreview).toHaveBeenCalledOnce();
		expect(onWeightCommit).toHaveBeenCalledOnce();
	});
});
