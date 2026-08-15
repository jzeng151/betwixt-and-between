import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { createRawSnippet, tick, type Snippet } from 'svelte';
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

function renderCanvas(
	onEdgeClick: (id: string) => void,
	onNodeOpen?: (id: string) => void,
	onNodePositionChange?: (id: string, position: { x: number; y: number }) => void,
	onEdgeContextMenu?: (id: string, x: number, y: number) => void,
	nodeOverlay?: Snippet<[{ id: string; hovered: boolean; dragging: boolean }]>,
	onConnect?: (fromId: string, toId: string, screenX: number, screenY: number) => void
) {
	return render(GraphCanvas, {
		props: {
			nodes,
			edges: [
				// Scoped, non-mystery caused_by → clickable.
				{ id: 'edge-clickable', fromId: 'effect', toId: 'cause', color: '#888', label: '', dimmed: false, clickable: true },
				// Same shape but clickable false (the mystery / unscoped case as
				// the host would compute it) → must NOT jump.
				{ id: 'edge-blocked', fromId: 'effect', toId: 'other', color: '#888', label: 'Blocked', dimmed: false, clickable: false },
				{ id: 'edge-mystery', fromId: 'cause', toId: 'other', color: '#888', label: 'Secret alliance', dimmed: false, mysteryMode: true },
				{ id: 'alias-pair', fromId: 'cause', toId: 'effect', color: '#888', label: 'Alias identity', dimmed: false }
			],
			dimmedNodes: new Set<string>(),
			initialPositions,
			onEdgeClick,
			onEdgeContextMenu,
			onNodeOpen,
			onNodePositionChange,
			nodeOverlay,
			onConnect
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
		expect(hitAreas.length).toBe(4); // every visual edge retains a pointer hit-area

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

	it('opens and moves graph nodes from the keyboard', async () => {
		const onNodeOpen = vi.fn();
		const onNodePositionChange = vi.fn();
		const { container } = renderCanvas(vi.fn(), onNodeOpen, onNodePositionChange);
		await tick();
		const node = container.querySelector('[data-entity-id="cause"]') as HTMLElement;

		await fireEvent.keyDown(node, { key: 'Enter' });
		await fireEvent.keyDown(node, { key: 'ArrowRight' });

		expect(onNodeOpen).toHaveBeenCalledWith('cause');
		expect(onNodePositionChange).toHaveBeenCalledWith(
			'cause',
			expect.objectContaining({ x: 8, y: 0 })
		);
		const description = document.getElementById(node.getAttribute('aria-describedby')!);
		expect(description).toHaveTextContent(/Arrow keys to move.*Hold Shift/i);
	});

	it('opens graph nodes from synthesized accessibility clicks only', async () => {
		const onNodeOpen = vi.fn();
		const { container } = renderCanvas(vi.fn(), onNodeOpen);
		await tick();
		const node = container.querySelector('[data-entity-id="cause"]') as HTMLElement;

		node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
		node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

		expect(onNodeOpen).toHaveBeenCalledOnce();
	});

	it('ignores synthesized clicks bubbled from node controls', async () => {
		const onNodeOpen = vi.fn();
		const { container } = renderCanvas(vi.fn(), onNodeOpen);
		await tick();
		const node = container.querySelector('[data-entity-id="cause"]') as HTMLElement;
		const control = node.appendChild(document.createElement('button'));

		control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

		expect(onNodeOpen).not.toHaveBeenCalled();
	});

	it('pans to keep a keyboard-moved node visible', async () => {
		const { container } = renderCanvas(vi.fn(), undefined, vi.fn());
		const viewport = container.querySelector('.viewport') as HTMLElement;
		Object.defineProperties(viewport, {
			clientWidth: { value: 240 },
			clientHeight: { value: 160 }
		});
		viewport.getBoundingClientRect = () => ({
			x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 160, width: 240, height: 160,
			toJSON: () => ({})
		}) as DOMRect;
		await tick();
		await Promise.resolve();
		await tick();
		const node = container.querySelector('[data-entity-id="cause"]') as HTMLElement;
		const canvas = container.querySelector('.canvas') as HTMLElement;
		const before = canvas.style.transform;

		for (let i = 0; i < 50; i++) await fireEvent.keyDown(node, { key: 'ArrowLeft' });
		await tick();

		expect(canvas.style.transform).not.toBe(before);
	});

	it('pans an off-screen node into view on focus', async () => {
		const { container } = renderCanvas(vi.fn());
		const viewport = container.querySelector('.viewport') as HTMLElement;
		viewport.getBoundingClientRect = () => ({
			x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40,
			toJSON: () => ({})
		}) as DOMRect;
		await tick();
		const canvas = container.querySelector('.canvas') as HTMLElement;
		const before = canvas.style.transform;

		(container.querySelector('[data-entity-id="other"]') as HTMLElement).focus();
		await tick();

		expect(canvas.style.transform).not.toBe(before);
	});

	it('restores focus to a node by id', async () => {
		const view = renderCanvas(vi.fn());
		await tick();

		view.component.focusNode('effect');

		expect(view.container.querySelector('[data-entity-id="effect"]')).toHaveFocus();

		view.component.focusNode('removed');
		expect(view.getByRole('application')).toHaveFocus();
	});

	it('renders node actions while the node owns keyboard focus', async () => {
		const nodeOverlay = createRawSnippet<[{ id: string; hovered: boolean; dragging: boolean }]>(() => ({
			render: () => '<button aria-label="Node action">Action</button>'
		}));
		const view = renderCanvas(vi.fn(), undefined, undefined, undefined, nodeOverlay);
		await tick();

		(view.container.querySelector('[data-entity-id="cause"]') as HTMLElement).focus();
		await tick();

		const action = view.getByRole('button', { name: 'Node action' });
		expect(action).toBeInTheDocument();
		expect(view.container.querySelector('[data-entity-id="cause"]')).not.toContainElement(action);
	});

	it('completes keyboard-started connections on node activation', async () => {
		const onConnect = vi.fn();
		const view = renderCanvas(vi.fn(), undefined, undefined, undefined, undefined, onConnect);
		await tick();

		view.component.startKeyboardConnect('cause');
		await fireEvent.keyDown(
			view.container.querySelector('[data-entity-id="effect"]') as HTMLElement,
			{ key: 'Enter' }
		);

		expect(onConnect).toHaveBeenCalledWith('cause', 'effect', expect.any(Number), expect.any(Number));
	});

	it('cancels keyboard connection mode with Escape', async () => {
		const onConnect = vi.fn();
		const onNodeOpen = vi.fn();
		const view = renderCanvas(vi.fn(), onNodeOpen, undefined, undefined, undefined, onConnect);
		await tick();
		const source = view.container.querySelector('[data-entity-id="cause"]') as HTMLElement;
		const target = view.container.querySelector('[data-entity-id="effect"]') as HTMLElement;

		view.component.startKeyboardConnect('cause');
		expect(source).toHaveFocus();
		await fireEvent.keyDown(source, { key: 'Escape' });
		await fireEvent.keyDown(target, { key: 'Enter' });

		expect(onConnect).not.toHaveBeenCalled();
		expect(onNodeOpen).toHaveBeenCalledWith('effect');
	});

	it('keeps source activation inside keyboard connection mode', async () => {
		const onConnect = vi.fn();
		const onNodeOpen = vi.fn();
		const view = renderCanvas(vi.fn(), onNodeOpen, undefined, undefined, undefined, onConnect);
		await tick();
		const source = view.container.querySelector('[data-entity-id="cause"]') as HTMLElement;

		view.component.startKeyboardConnect('cause');
		await fireEvent.keyDown(source, { key: 'Enter' });

		expect(onConnect).not.toHaveBeenCalled();
		expect(onNodeOpen).not.toHaveBeenCalled();
	});

	it('leaves reserved modified Arrow shortcuts to the browser', async () => {
		const onNodePositionChange = vi.fn();
		const { container } = renderCanvas(vi.fn(), undefined, onNodePositionChange);
		await tick();
		const node = container.querySelector('[data-entity-id="cause"]') as HTMLElement;

		for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
			const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, ...modifier });
			node.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(onNodePositionChange).not.toHaveBeenCalled();
	});

	it('exposes edge actions in the keyboard tab order', async () => {
		const onEdgeClick = vi.fn();
		const { container } = renderCanvas(onEdgeClick);
		await tick();
		const actions = container.querySelectorAll<HTMLButtonElement>('.edge-keyboard-action');

		expect(actions.length).toBe(1);
		await fireEvent.click(actions[0]);
		expect(onEdgeClick).toHaveBeenCalledWith('edge-clickable');
	});

	it('pans an off-screen edge action into view on focus', async () => {
		const { container } = renderCanvas(vi.fn());
		const viewport = container.querySelector('.viewport') as HTMLElement;
		Object.defineProperties(viewport, {
			clientWidth: { value: 160, configurable: true },
			clientHeight: { value: 120, configurable: true }
		});
		await tick();
		await Promise.resolve();
		await tick();
		const action = container.querySelector<HTMLButtonElement>('.edge-keyboard-action')!;
		const before = action.style.left;
		Object.defineProperties(viewport, {
			clientWidth: { value: 40, configurable: true },
			clientHeight: { value: 40, configurable: true }
		});

		action.focus();
		await tick();

		expect(action.style.left).not.toBe(before);
	});

	it('exposes mystery context actions without revealing details', async () => {
		const onEdgeContextMenu = vi.fn();
		const { container } = renderCanvas(vi.fn(), undefined, undefined, onEdgeContextMenu);
		await tick();
		const actions = [...container.querySelectorAll<HTMLButtonElement>('.edge-keyboard-action')];

		expect(actions).toHaveLength(3);
		expect(actions.map((action) => action.getAttribute('aria-label')).join(' ')).not.toMatch(/Secret|Alias/);
		expect(actions.some((action) => action.getAttribute('aria-label') === 'Edit hidden relationship')).toBe(true);
		await fireEvent.click(actions.find((action) => action.getAttribute('aria-label')?.startsWith('Blocked'))!);
		expect(onEdgeContextMenu).toHaveBeenCalledWith('edge-blocked', expect.any(Number), expect.any(Number));
	});
});
