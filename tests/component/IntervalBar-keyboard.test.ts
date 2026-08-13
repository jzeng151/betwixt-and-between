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
		const bar = container.querySelector('.bar-activate') as SVGElement;
		const split = container.querySelector('rect.hairline-hit') as SVGElement;
		expect(split.parentElement).toHaveAttribute('role', 'group');

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

	it('gives each split point a distinct position label', () => {
		const { container } = render(IntervalBar, {
			props: {
				name: 'Journey',
				tooltipText: 'Journey interval',
				color: '#c8942a',
				widthPx: 100,
				internalBoundaries: [0.25, 0.75],
				onSplit: vi.fn()
			}
		});
		const labels = [...container.querySelectorAll('rect.hairline-hit')].map((hit) =>
			hit.getAttribute('aria-label')
		);

		expect(labels).toEqual([
			'Split interval at 25% of this interval',
			'Split interval at 75% of this interval'
		]);
	});
});
