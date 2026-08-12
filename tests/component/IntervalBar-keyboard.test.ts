import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntervalBar from '$lib/features/timeline/IntervalBar.svelte';

beforeEach(cleanup);

describe('IntervalBar keyboard controls', () => {
	it('activates the bar and split points with Enter or Space', async () => {
		const onActivate = vi.fn();
		const onSplit = vi.fn();
		const { container } = render(IntervalBar, {
			props: {
				name: 'Journey',
				tooltipText: 'Journey interval',
				color: '#c8942a',
				widthPx: 240,
				internalBoundaries: [0.5],
				onActivate,
				onSplit
			}
		});
		const bar = container.querySelector('svg.interval-bar') as SVGElement;
		const split = container.querySelector('rect.hairline-hit') as SVGElement;

		await fireEvent.keyDown(bar, { key: 'Enter' });
		await fireEvent.keyDown(split, { key: ' ' });

		expect(onActivate).toHaveBeenCalledOnce();
		expect(onSplit).toHaveBeenCalledWith(0.5);
	});
});
