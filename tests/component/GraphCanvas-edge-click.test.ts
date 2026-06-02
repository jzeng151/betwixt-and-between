import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import GraphCanvas from '$lib/features/graph/GraphCanvas.svelte';

// WM3 Slice 5 — Codex P1. The edge hit-area <line> is rendered for EVERY edge
// (so right-click edit always works), and onEdgeClickHandler used to call
// onEdgeClick for any edge. That let a left-click on the invisible hit-line of
// a NON-clickable edge (e.g. a mystery caused_by edge, whose `clickable` is
// false) reach the host's jumpToCause and leak the hidden link's story-time.
// The handler now gates on `edge.clickable`. This pins that gate at the surface
// that owns it — independent of how StoryGraph/FocusedGraph derive `clickable`.

beforeEach(() => {
	cleanup();
	// jsdom has no ResizeObserver; GraphCanvas wires one on mount.
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

const nodes = [
	{ id: 'cause', type: 'Event', name: 'Cause' },
	{ id: 'effect', type: 'Event', name: 'Effect' },
	{ id: 'other', type: 'Event', name: 'Other' }
];

const initialPositions = {
	cause: { x: 0, y: 0, w: 120, h: 32 },
	effect: { x: 200, y: 0, w: 120, h: 32 },
	other: { x: 0, y: 200, w: 120, h: 32 }
};

function renderCanvas(onEdgeClick: (id: string) => void) {
	return render(GraphCanvas, {
		props: {
			nodes,
			edges: [
				// Scoped, non-mystery caused_by → clickable.
				{ id: 'edge-clickable', fromId: 'effect', toId: 'cause', color: '#888', label: '', dimmed: false, clickable: true },
				// Same shape but clickable false (the mystery / unscoped case as
				// the host would compute it) → must NOT jump.
				{ id: 'edge-blocked', fromId: 'effect', toId: 'other', color: '#888', label: '', dimmed: false, clickable: false }
			],
			dimmedNodes: new Set<string>(),
			initialPositions,
			onEdgeClick
		}
	});
}

describe('GraphCanvas edge click gate', () => {
	it('left-clicking a non-clickable edge hit-area does NOT fire onEdgeClick', async () => {
		const onEdgeClick = vi.fn();
		const { container } = renderCanvas(onEdgeClick);
		await tick();

		// Hit-area lines are the interactive ones (pointer-events="stroke").
		const hitAreas = Array.from(
			container.querySelectorAll('line[pointer-events="stroke"]')
		) as SVGLineElement[];
		expect(hitAreas.length).toBe(2); // both edges render a hit-area

		// Click every hit-area. Only the clickable edge may reach onEdgeClick.
		for (const line of hitAreas) await fireEvent.click(line);

		expect(onEdgeClick).toHaveBeenCalledTimes(1);
		expect(onEdgeClick).toHaveBeenCalledWith('edge-clickable');
		expect(onEdgeClick).not.toHaveBeenCalledWith('edge-blocked');
	});

	it('the clickable edge carries the edge-clickable cursor class, the blocked one does not', async () => {
		const onEdgeClick = vi.fn();
		const { container } = renderCanvas(onEdgeClick);
		await tick();

		const clickable = container.querySelectorAll('line.edge-clickable');
		expect(clickable.length).toBe(1);
	});
});
