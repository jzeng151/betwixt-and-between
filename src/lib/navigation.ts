import { get } from 'svelte/store';
import { entities } from './stores/entities.js';
import { windowStore } from './stores/windows.js';

export function openEntity(id: string) {
	const entity = get(entities).find((e) => e.id === id);
	if (!entity) return;
	windowStore.openForEntity(id, entity.type);
}
