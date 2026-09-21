import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import GridBrush from '$lib/features/map/PixiBrushLayer.svelte';
import FreeformBrush from '$lib/features/map/PixiFreeformBrushLayer.svelte';
import { PIXI_STAGE_CONTEXT } from '$lib/features/map/pixi-context.js';
import { playhead } from '$lib/features/timeline/playhead-store.js';
import { mapEventsStore } from '$lib/features/map/map-events-store.js';
import type { WorldMap } from '$lib/features/map/types.js';

vi.mock('pixi.js', () => {
	class Container {
		addChild() {}
		destroy() {}
	}
	class Graphics extends Container {
		clear() {}
		moveTo() {}
		lineTo() {}
		stroke() {}
		rect() {}
		fill() {}
	}
	return { Container, Graphics };
});
vi.mock('$lib/features/map/map-events-store.js', () => ({
	mapEventsStore: { create: vi.fn().mockResolvedValue({}) }
}));

const map = { id: 'map-a', width: 100, height: 100, gridType: 'square', gridCellsX: 10, gridCellsY: 10 } as WorldMap;
const pointer = { button: 0, pointerId: 1, getLocalPosition: () => ({ x: 20, y: 20 }) };

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	playhead.pause();
});

describe.each([
	['grid', GridBrush, 'paint_cells'],
	['freeform', FreeformBrush, 'paint_stroke']
] as const)('%s brush gesture', (_name, Brush, kind) => {
	async function setup() {
		const viewport = Object.assign(new EventEmitter(), { addChild() {} });
		const options = {
			props: { active: true, activeMap: map },
			context: new Map([[PIXI_STAGE_CONTEXT, { viewport }]])
		};
		const view = Brush === GridBrush ? render(GridBrush, options) : render(FreeformBrush, options);
		await waitFor(() => expect(viewport.listenerCount('pointerdown')).toBe(1));
		return { viewport, view };
	}

	it('saves at the story time where the gesture started even if playback advances', async () => {
		const { viewport } = await setup();
		playhead.scrubTo(0.25);
		viewport.emit('pointerdown', pointer);
		playhead.scrubTo(1.75);
		viewport.emit('pointerup', pointer);
		await waitFor(() => expect(mapEventsStore.create).toHaveBeenCalledWith('map-a', expect.objectContaining({
			tPosition: 0.25, kind
		})));
	});

	it('does not save the old gesture onto a newly selected map', async () => {
		const { viewport, view } = await setup();
		viewport.emit('pointerdown', pointer);
		await view.rerender({ active: true, activeMap: { ...map, id: 'map-b' } });
		viewport.emit('pointerup', pointer);
		expect(mapEventsStore.create).not.toHaveBeenCalled();
		viewport.emit('pointerdown', pointer);
		viewport.emit('pointerup', pointer);
		await waitFor(() => expect(mapEventsStore.create).toHaveBeenCalledWith('map-b', expect.objectContaining({ kind })));
	});
});
