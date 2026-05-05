import { writable, get } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';

export type AppId =
	| 'character-editor'
	| 'world-map'
	| 'timeline'
	| 'entity-detail'
	| 'wiki'
	| 'story-graph'
	| 'focused-graph'
	| 'notes'
	| 'settings';

/**
 * View modes for `focused-graph` windows (Phase 1B Lane C):
 *   - `shared`        — only entities reachable from EVERY focal node (intersection)
 *   - `their_worlds`  — union of 1-hop neighbors of any focal node
 *   - `reachable`     — cycle-safe BFS from any focal node (everything they touch)
 */
export type FocusedGraphMode = 'shared' | 'their_worlds' | 'reachable';

export type WindowState = {
	id: string;
	appId: AppId;
	entityId: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	minimized: boolean;
	maximized: boolean;
	zIndex: number;
	// FocusedGraph window state. Only set on appId === 'focused-graph'.
	// focalSet writes MUST reassign (`focalSet = [...focalSet, id]`),
	// never push/Object.assign, to keep Svelte 5 $derived invalidation
	// correct downstream. The store's `update` already reassigns the
	// whole window object so mutation through the store helpers below
	// is safe; component-local mirrors must follow the same rule.
	focalSet?: string[];
	viewMode?: FocusedGraphMode;
	typeOrder?: EntityType[];
};

/**
 * Routes an entity type to its default app. Locked 2026-04-29 in
 * /plan-design-review (D10-extension/Issue 19A): Acts/Events/Scenes route
 * to the unified `'entity-detail'` window since they have rich editors
 * (ActEditor, EventEditor, SceneEditor). Notes joined them in the Wiki
 * rework (slice 1) — Note entities now open in EntityDetail with the
 * NoteWikiEditor branch. Characters and Locations keep their dedicated
 * apps until the Wiki rework's parity slice flips them.
 */
const ENTITY_APP: Record<EntityType, AppId> = {
	Character: 'character-editor',
	Location: 'world-map',
	Event: 'entity-detail',
	Act: 'entity-detail',
	Scene: 'entity-detail',
	Note: 'entity-detail'
};

let lastOpenX = 80;
let lastOpenY = 80;
let zCounter = 100;

function createWindowStore() {
	const { subscribe, update, set } = writable<WindowState[]>([]);

	function open(appId: AppId, entityId: string | null = null): string {
		// story-graph and focused-graph windows are always independent —
		// each open call creates a new instance. Other apps dedupe by id
		// (single timeline / wiki / entity-detail per entity).
		const isMultiInstance = appId === 'story-graph' || appId === 'focused-graph';
		const windowId = isMultiInstance
			? `${appId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			: entityId ? `${appId}-${entityId}` : appId;

		const existing = get({ subscribe }).find((w) => w.id === windowId);
		if (existing) {
			focus(windowId);
			return windowId;
		}

		const x = lastOpenX;
		const y = lastOpenY;
		lastOpenX = lastOpenX + 28 > 520 ? 80 : lastOpenX + 28;
		lastOpenY = lastOpenY + 28 > 400 ? 80 : lastOpenY + 28;
		zCounter++;

		const isGraph = appId === 'story-graph' || appId === 'focused-graph';

		update((all) => [
			...all,
			{
				id: windowId,
				appId,
				entityId,
				x,
				y,
				width:
					isGraph
						? 640
						: appId === 'timeline'
							? 960
							: appId === 'settings'
								? 520
								: appId === 'entity-detail'
									? 480
									: appId === 'character-editor'
										? 380
										: 320,
				height:
					isGraph
						? 500
						: appId === 'settings'
							? 400
							: appId === 'notes'
								? 450
								: 480,
				minimized: false,
				maximized: false,
				zIndex: zCounter,
				// Seed focused-graph windows with empty focal set + default
				// view mode + undefined typeOrder (caller may set right after).
				...(appId === 'focused-graph'
					? { focalSet: [] as string[], viewMode: 'their_worlds' as FocusedGraphMode }
					: {})
			}
		]);
		return windowId;
	}

	/**
	 * Open a fresh FocusedGraph window seeded with a focal set. Returns the
	 * new window id so callers can pass it to <FocusedGraph windowId={...} />.
	 * Each call creates an independent window; multiple FocusedGraph
	 * instances are by design (Phase 1B C1).
	 */
	function openFocusedGraph(
		focalSet: string[],
		viewMode: FocusedGraphMode = 'their_worlds'
	): string {
		const windowId = open('focused-graph', null);
		update((all) =>
			all.map((w) => (w.id === windowId ? { ...w, focalSet: [...focalSet], viewMode } : w))
		);
		return windowId;
	}

	/**
	 * Replace the focal set for a window. Reassigns the array (never mutates)
	 * so Svelte 5 $derived dependencies invalidate correctly.
	 */
	function setFocalSet(windowId: string, focalSet: string[]) {
		update((all) =>
			all.map((w) => (w.id === windowId ? { ...w, focalSet: [...focalSet] } : w))
		);
	}

	function setViewMode(windowId: string, viewMode: FocusedGraphMode) {
		update((all) => all.map((w) => (w.id === windowId ? { ...w, viewMode } : w)));
	}

	function setTypeOrder(windowId: string, typeOrder: EntityType[]) {
		update((all) =>
			all.map((w) => (w.id === windowId ? { ...w, typeOrder: [...typeOrder] } : w))
		);
	}

	function openForEntity(entityId: string, entityType: EntityType): string {
		const appId = ENTITY_APP[entityType];
		const windowId = `${appId}-${entityId}`;
		const existing = get({ subscribe }).find((w) => w.id === windowId);
		if (existing) {
			focus(windowId);
			return windowId;
		}
		return open(appId, entityId);
	}

	function close(id: string) {
		// Fire-and-forget cleanup for focused-graph windows: drop the per-
		// window canvas rows so they don't orphan in window_canvas_state.
		// Lane A's DELETE endpoint accepts the windowId and removes ALL
		// rows for it. Tab close / page reload won't go through this path
		// — user expects state preserved on those — so cleanup only fires
		// on explicit close (X button or Ctrl-W).
		const w = get({ subscribe }).find((x) => x.id === id);
		if (w?.appId === 'focused-graph' && typeof fetch !== 'undefined') {
			void fetch(`/api/canvas-positions/window/${id}`, { method: 'DELETE' }).catch(() => {
				// non-fatal — the row stays orphan, no user impact
			});
		}
		update((all) => all.filter((w) => w.id !== id));
	}

	function focus(id: string) {
		zCounter++;
		const z = zCounter;
		update((all) =>
			all.map((w) => (w.id === id ? { ...w, zIndex: z, minimized: false } : w))
		);
	}

	function minimize(id: string) {
		update((all) => all.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
	}

	function move(id: string, x: number, y: number) {
		update((all) => all.map((w) => (w.id === id ? { ...w, x, y } : w)));
	}

	function resize(id: string, width: number, height: number) {
		update((all) => all.map((w) => (w.id === id ? { ...w, width, height } : w)));
	}

	function maximize(id: string) {
		zCounter++;
		const z = zCounter;
		update((all) =>
			all.map((w) => (w.id === id ? { ...w, maximized: !w.maximized, minimized: false, zIndex: z } : w))
		);
	}

	function setEntityId(id: string, entityId: string) {
		update((all) => all.map((w) => (w.id === id ? { ...w, entityId } : w)));
	}

	function focusedWindow(): WindowState | undefined {
		const all = get({ subscribe });
		return all.reduce<WindowState | undefined>(
			(top, w) => (!top || w.zIndex > top.zIndex ? w : top),
			undefined
		);
	}

	function cycleForward() {
		const all = get({ subscribe }).filter((w) => !w.minimized);
		if (all.length < 2) return;
		const sorted = [...all].sort((a, b) => a.zIndex - b.zIndex);
		const next = sorted[sorted.length - 1];
		focus(next.id);
	}

	function cycleBackward() {
		const all = get({ subscribe }).filter((w) => !w.minimized);
		if (all.length < 2) return;
		const sorted = [...all].sort((a, b) => a.zIndex - b.zIndex);
		const next = sorted[0];
		focus(next.id);
	}

	/**
	 * Find any open editor window for an entity, regardless of which app
	 * hosts it. Used by the Timeline's mutex check (D2/Issue 2B-i): clicking
	 * an entity should focus an existing window before opening a new one.
	 * Matches by `entityId` so the check works even during the Wiki PR's
	 * phased migration where some types still use legacy app routing.
	 */
	function findOpenEditorFor(entityId: string): WindowState | undefined {
		return get({ subscribe }).find((w) => w.entityId === entityId);
	}

	return {
		subscribe,
		open,
		openForEntity,
		openFocusedGraph,
		setFocalSet,
		setViewMode,
		setTypeOrder,
		close,
		focus,
		minimize,
		maximize,
		move,
		resize,
		setEntityId,
		focusedWindow,
		findOpenEditorFor,
		cycleForward,
		cycleBackward
	};
}

export const windowStore = createWindowStore();
