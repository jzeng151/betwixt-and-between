import { writable, get } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';
import { type AppId, persistsPosition } from './app-ids.js';
import { preferences } from './preferences-store.js';
import { applyPreferencePatch, preferencesOwnershipResolved } from './preferences-sync.js';
import { clampToViewport } from './context-menu-clamp.js';

// Re-export so existing `import type { AppId } from '$lib/os/windows-store'`
// call sites (Taskbar, app-catalog, WindowManager) keep working.
export type { AppId };

/**
 * View modes for `focused-graph` windows (Phase 1B Lane C):
 *   - `shared`        — only entities reachable from EVERY focal node (intersection)
 *   - `their_worlds`  — union of 1-hop neighbors of any focal node
 *   - `reachable`     — cycle-safe BFS from any focal node (everything they touch)
 */
export type FocusedGraphMode = 'shared' | 'their_worlds' | 'reachable';

type WindowState = {
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
	// When true, the window renders with a boosted z-index that keeps it
	// above all non-pinned windows regardless of focus changes.
	alwaysOnTop?: boolean;
	// True once the user has dragged/resized this window. The one-shot
	// post-hydrate default re-apply (below) skips adjusted windows so it never
	// clobbers a deliberate in-session move.
	geomAdjusted?: boolean;
};

/** Z-index offset applied to `alwaysOnTop` windows so they float above the rest. */
export const PIN_Z_BASE = 10000;

/**
 * Per-app default open size. The Record<AppId, ...> type makes the compiler
 * catch any new AppId that forgets to declare a size — previously this lived
 * as parallel nested ternaries that silently fell through to a default.
 */
export const WINDOW_DEFAULTS: Record<AppId, { width: number; height: number }> = {
	'character-editor': { width: 380, height: 480 },
	'world-map':        { width: 1024, height: 720 },
	'timeline':         { width: 960, height: 480 },
	'entity-detail':    { width: 480, height: 480 },
	'wiki':             { width: 980, height: 700 },
	'story-graph':      { width: 640, height: 500 },
	'focused-graph':    { width: 640, height: 500 },
	'notes':            { width: 320, height: 450 },
	'settings':         { width: 520, height: 400 },
	'story-player':     { width: 280, height: 100 }
};

/**
 * Routes an entity type to its default app. Locked 2026-04-29 in
 * /plan-design-review (D10-extension/Issue 19A) for Acts/Events/Scenes;
 * Notes joined in Wiki rework slice 1; Character + Location joined in
 * slice 6 once CharacterEditor's detail surface was extracted into
 * CharacterEditorBody (mounted by EntityDetail's CharacterWikiEditor)
 * and LocationEditor gained read-only linked-entity chips for parity
 * with the WorldMap card UX.
 *
 * The 'character-editor' and 'world-map' app ids still exist as the
 * dock-launcher list views (Characters list / WorldMap canvas) — they
 * just no longer own the per-entity editor surface.
 */
const ENTITY_APP: Record<EntityType, AppId> = {
	Character: 'entity-detail',
	Location: 'entity-detail',
	Event: 'entity-detail',
	Act: 'entity-detail',
	Scene: 'entity-detail',
	Note: 'entity-detail',
	Artifact: 'entity-detail',
	Item: 'entity-detail'
};

let lastOpenX = 80;
let lastOpenY = 80;
let zCounter = 100;

/**
 * Read --taskbar-height from :root. Falls back to 52 in SSR / before the
 * stylesheet attaches. Kept inline (not exported) because this is shell
 * layout math, not a public API.
 */
function readTaskbarHeight(): number {
	if (typeof window === 'undefined') return 52;
	const raw = getComputedStyle(document.documentElement)
		.getPropertyValue('--taskbar-height')
		.trim();
	const parsed = parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : 52;
}

/**
 * Clamp an open position AND size so the window lands fully inside the viewport
 * (minus the taskbar) — Item 3 (A2/F5): a saved default x/y that lands off-screen
 * after a viewport resize is corrected on every open, not just at save. Size is
 * also capped to the usable area so a window taller than (innerHeight - taskbar)
 * never spills its bottom under the fixed taskbar (which would occlude bottom-
 * anchored controls like the map tool palette). No-op in SSR.
 */
function clampOpenGeom(
	x: number,
	y: number,
	width: number,
	height: number
): { x: number; y: number; width: number; height: number } {
	if (typeof window === 'undefined') return { x, y, width, height };
	const usableH = Math.max(0, window.innerHeight - readTaskbarHeight());
	const w = Math.min(width, window.innerWidth);
	const h = Math.min(height, usableH);
	const pos = clampToViewport(x, y, w, h, window.innerWidth, usableH);
	return { x: pos.x, y: pos.y, width: w, height: h };
}

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

		let x = lastOpenX;
		let y = lastOpenY;
		const defaults = WINDOW_DEFAULTS[appId];
		// Item 3: a "set current as default" geometry overrides the hardcoded
		// WINDOW_DEFAULTS. Size applies to every AppId; position only to
		// single-instance apps (persistsPosition) — multi-instance apps keep the
		// open-stagger so instances don't stack.
		const saved = get(preferences).windows.defaults[appId];
		let width = saved?.width ?? defaults.width;
		let height = saved?.height ?? defaults.height;
		const savedPos =
			saved && persistsPosition(appId) && saved.x !== undefined && saved.y !== undefined
				? { x: saved.x, y: saved.y }
				: null;
		if (savedPos) {
			x = savedPos.x;
			y = savedPos.y;
		} else if (appId === 'story-player' && typeof window !== 'undefined') {
			// Anchor the Story Player just above the taskbar so it acts like
			// a transport bar by default. Taskbar height lives in --taskbar-height
			// (src/app.css); read at runtime so the JS math tracks any CSS change.
			const taskbarH = readTaskbarHeight();
			const gap = 12;
			x = Math.max(8, Math.floor((window.innerWidth - width) / 2));
			y = Math.max(8, window.innerHeight - taskbarH - height - gap);
		} else {
			lastOpenX = lastOpenX + 28 > 520 ? 80 : lastOpenX + 28;
			lastOpenY = lastOpenY + 28 > 400 ? 80 : lastOpenY + 28;
		}
		// Clamp every open so a saved (or staggered) position that now lands
		// off-screen is corrected.
		({ x, y, width, height } = clampOpenGeom(x, y, width, height));
		zCounter++;

		update((all) => [
			...all,
			{
				id: windowId,
				appId,
				entityId,
				x,
				y,
				width,
				height,
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
	 * Shallow-merge `patch` into the window matching `id`. Centralizes the
	 * find-and-spread pattern used by every state mutator that doesn't also
	 * advance zCounter or read the current window value.
	 *
	 * Toggle mutators (togglePin, maximize) and ones that bump zCounter
	 * (focus, maximize) stay inline — they need access to the current
	 * window state or to shared counters.
	 */
	function patchWindow(id: string, patch: Partial<WindowState>) {
		update((all) => all.map((w) => (w.id === id ? { ...w, ...patch } : w)));
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
		patchWindow(windowId, { focalSet: [...focalSet], viewMode });
		return windowId;
	}

	/**
	 * Replace the focal set for a window. Reassigns the array (never mutates)
	 * so Svelte 5 $derived dependencies invalidate correctly.
	 */
	function setFocalSet(windowId: string, focalSet: string[]) {
		patchWindow(windowId, { focalSet: [...focalSet] });
	}

	function setViewMode(windowId: string, viewMode: FocusedGraphMode) {
		patchWindow(windowId, { viewMode });
	}

	function setTypeOrder(windowId: string, typeOrder: EntityType[]) {
		patchWindow(windowId, { typeOrder: [...typeOrder] });
	}

	function openForEntity(entityId: string, entityType: EntityType): string {
		// Fallback covers a legacy pre-migration entity type (e.g. 'Door' before
		// drizzle/0011 rewrites it to Artifact) flowing in via /api/entities on
		// an environment where the migration hasn't run yet. Every current type
		// routes to 'entity-detail' anyway, so this is the right default.
		const appId = ENTITY_APP[entityType] ?? 'entity-detail';
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
		patchWindow(id, { minimized: true });
	}

	function move(id: string, x: number, y: number) {
		patchWindow(id, { x, y, geomAdjusted: true });
	}

	function resize(id: string, width: number, height: number) {
		patchWindow(id, { width, height, geomAdjusted: true });
	}

	function maximize(id: string) {
		zCounter++;
		const z = zCounter;
		update((all) =>
			all.map((w) => (w.id === id ? { ...w, maximized: !w.maximized, minimized: false, zIndex: z } : w))
		);
	}

	function togglePin(id: string) {
		update((all) =>
			all.map((w) => (w.id === id ? { ...w, alwaysOnTop: !w.alwaysOnTop } : w))
		);
	}

	function setEntityId(id: string, entityId: string) {
		patchWindow(id, { entityId });
	}

	/**
	 * Item 3 — "set current as default": persist this window's settled geometry
	 * as the open default for its AppId. Size for every app; position only for
	 * single-instance apps (persistsPosition). Called from a titlebar click, so
	 * it always reads post-drag geometry (the F5 commit-boundary requirement —
	 * never mid-drag). Maximized windows are skipped (their frame is the
	 * maximized rect, not a meaningful default).
	 */
	function setAsDefault(id: string): void {
		const w = get({ subscribe }).find((x) => x.id === id);
		if (!w || w.maximized) return;
		const geom: { width: number; height: number; x?: number; y?: number } = {
			width: w.width,
			height: w.height
		};
		if (persistsPosition(w.appId)) {
			geom.x = w.x;
			geom.y = w.y;
		}
		applyPreferencePatch({ set: { windows: { defaults: { [w.appId]: geom } } } });
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

	// codex P2: a window opened BEFORE the initial /api/preferences hydrate
	// snapshots the built-in WINDOW_DEFAULTS (no saved geometry yet). When
	// ownership first resolves (hydrate installs windows.defaults), re-apply the
	// saved geometry ONCE to every open window the user hasn't moved/resized
	// (geomAdjusted), so a fresh-device window opened in the sub-second before
	// hydrate still lands at the saved size/position. Size for all apps; position
	// only for singleton apps (persistsPosition); clamped to the viewport.
	let _defaultsReapplied = false;
	preferencesOwnershipResolved.subscribe((resolved) => {
		if (!resolved || _defaultsReapplied) return;
		_defaultsReapplied = true;
		const defaults = get(preferences).windows.defaults;
		update((all) =>
			all.map((w) => {
				if (w.geomAdjusted || w.maximized) return w;
				const saved = defaults[w.appId];
				if (!saved) return w;
				let x = w.x;
				let y = w.y;
				if (persistsPosition(w.appId) && saved.x !== undefined && saved.y !== undefined) {
					x = saved.x;
					y = saved.y;
				}
				const clamped = clampOpenGeom(x, y, saved.width, saved.height);
				return { ...w, width: clamped.width, height: clamped.height, x: clamped.x, y: clamped.y };
			})
		);
	});

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
		togglePin,
		setEntityId,
		setAsDefault,
		focusedWindow,
		findOpenEditorFor,
		cycleForward,
		cycleBackward
	};
}

export const windowStore = createWindowStore();
