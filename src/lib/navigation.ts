import { get } from 'svelte/store';
import { entities } from './stores/entities.js';
import { windowStore } from './stores/windows.js';

/**
 * Open an entity in its type-routed app per `ENTITY_APP`. Post D10-extension
 * (Issue 19A, locked 2026-04-29), Acts/Events/Scenes route to the unified
 * `'entity-detail'` window; Characters → CharacterEditor, Locations → WorldMap,
 * Notes → Wiki (those types migrate to `'entity-detail'` when the Wiki rework
 * lands).
 */
export function openEntity(id: string) {
	const entity = get(entities).find((e) => e.id === id);
	if (!entity) return;
	windowStore.openForEntity(id, entity.type);
}

/**
 * Always open the unified entity-detail window for any entityId, regardless
 * of type. Used by future Wiki entry hyperlinks and by the Timeline's
 * "↗ Move to window" button on the side panel. Locked 2026-04-29 in
 * /plan-design-review (D10/Issue 9A) — sibling to `openEntity`. If a window
 * already hosts this entity (matched by entityId), focuses the existing one.
 */
export function openEntityDetail(id: string): string {
	return windowStore.open('entity-detail', id);
}
