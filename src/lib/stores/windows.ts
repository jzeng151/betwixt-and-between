import { writable, get } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';

export type AppId =
	| 'character-editor'
	| 'world-map'
	| 'timeline'
	| 'entity-detail'
	| 'wiki'
	| 'story-graph';

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
};

/**
 * Routes an entity type to its default app. Locked 2026-04-29 in
 * /plan-design-review (D10-extension/Issue 19A): Acts/Events/Scenes route
 * to the unified `'entity-detail'` window since they have rich editors
 * (ActEditor, EventEditor, SceneEditor). Characters/Locations/Notes stay
 * with their existing apps until the Wiki rework migrates them too.
 */
const ENTITY_APP: Record<EntityType, AppId> = {
	Character: 'character-editor',
	Location: 'world-map',
	Event: 'entity-detail',
	Act: 'entity-detail',
	Scene: 'entity-detail',
	Note: 'wiki'
};

let lastOpenX = 80;
let lastOpenY = 80;
let zCounter = 100;

function createWindowStore() {
	const { subscribe, update, set } = writable<WindowState[]>([]);

	function open(appId: AppId, entityId: string | null = null): string {
		// story-graph windows are always independent — each open call creates a new instance
		const windowId = appId === 'story-graph'
			? `story-graph-${Date.now()}`
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

		const isGraph = appId === 'story-graph';

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
							: appId === 'entity-detail'
								? 480
								: 320,
				height: isGraph ? 500 : 480,
				minimized: false,
				maximized: false,
				zIndex: zCounter
			}
		]);
		return windowId;
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
