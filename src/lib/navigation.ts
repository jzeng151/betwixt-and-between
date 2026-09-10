import { get } from 'svelte/store';
import { entities } from './stores/entities.js';
import { windowStore } from './os/windows-store.js';

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
