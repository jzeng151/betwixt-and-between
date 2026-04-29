import { writable } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';

export type Entity = {
	id: string;
	type: EntityType;
	name: string;
	data: string;
	parentId: string | null;
	position: number | null;
	createdAt: number | Date;
	updatedAt: number | Date;
};

function createEntityStore() {
	const { subscribe, set, update } = writable<Entity[]>([]);

	async function load() {
		const res = await fetch('/api/entities');
		const data: Entity[] = await res.json();
		set(data);
	}

	async function createEntity(type: EntityType, name: string, data?: unknown): Promise<Entity> {
		const res = await fetch('/api/entities', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type, name, data })
		});
		if (!res.ok) throw new Error(await res.text());
		const created: Entity = await res.json();
		update((all) => [...all, created]);
		return created;
	}

	async function updateEntity(id: string, patch: { name?: string; data?: unknown }): Promise<Entity> {
		const optimistic = patch;
		update((all) =>
			all.map((e) =>
				e.id === id
					? {
							...e,
							...(optimistic.name !== undefined ? { name: optimistic.name } : {}),
							...(optimistic.data !== undefined ? { data: JSON.stringify(optimistic.data) } : {})
						}
					: e
			)
		);

		const res = await fetch(`/api/entities/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) {
			await load();
			throw new Error(await res.text());
		}
		const updated: Entity = await res.json();
		update((all) => all.map((e) => (e.id === id ? updated : e)));
		return updated;
	}

	async function deleteEntity(id: string): Promise<void> {
		update((all) => all.filter((e) => e.id !== id));
		try {
			const res = await fetch(`/api/entities/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				await load();
				throw new Error(await res.text());
			}
		} catch (err) {
			// Network error before response — recover the optimistic remove.
			await load();
			throw err;
		}
	}

	return { subscribe, load, createEntity, updateEntity, deleteEntity };
}

export const entities = createEntityStore();
