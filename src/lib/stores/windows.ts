import { writable, get } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';

export type AppId =
	| 'character-editor'
	| 'world-map'
	| 'timeline'
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
	zIndex: number;
};

const ENTITY_APP: Record<EntityType, AppId> = {
	Character: 'character-editor',
	Location: 'world-map',
	Event: 'timeline',
	Act: 'timeline',
	Scene: 'timeline',
	Note: 'wiki'
};

let spawnOffset = 0;
let zCounter = 100;

function createWindowStore() {
	const { subscribe, update, set } = writable<WindowState[]>([]);

	function open(appId: AppId, entityId: string | null = null): string {
		const windowId = entityId ? `${appId}-${entityId}` : appId;
		const existing = get({ subscribe }).find((w) => w.id === windowId);
		if (existing) {
			focus(windowId);
			return windowId;
		}

		const n = spawnOffset % 8;
		const x = 60 + n * 24;
		const y = 60 + n * 24;
		spawnOffset++;
		zCounter++;

		update((all) => [
			...all,
			{
				id: windowId,
				appId,
				entityId,
				x,
				y,
				width: 320,
				height: 480,
				minimized: false,
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

	return {
		subscribe,
		open,
		openForEntity,
		close,
		focus,
		minimize,
		move,
		resize,
		focusedWindow,
		cycleForward,
		cycleBackward
	};
}

export const windowStore = createWindowStore();
