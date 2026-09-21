import { get } from 'svelte/store';
import { entities } from './stores/entities.js';
import { windowStore } from './os/windows-store.js';

/** Open the entity in the app selected by ENTITY_APP. */
export function openEntity(id: string) {
	const entity = get(entities).find((e) => e.id === id);
	if (!entity) return;
	windowStore.openForEntity(id, entity.type);
}
