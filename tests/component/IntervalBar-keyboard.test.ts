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

	it('partitions nearby split hit areas without overlap', () => {
		const { container } = render(IntervalBar, {
			props: {
				name: 'Journey',
				tooltipText: 'Journey interval',
				color: '#c8942a',
				widthPx: 100,
				internalBoundaries: [0.45, 0.5],
				onSplit: vi.fn()
			}
		});
		const hits = [...container.querySelectorAll<SVGRectElement>('rect.hairline-hit')];
		const firstRight = Number(hits[0].getAttribute('x')) + Number(hits[0].getAttribute('width'));
		const secondLeft = Number(hits[1].getAttribute('x'));

		expect(firstRight).toBe(secondLeft);
	});
});
