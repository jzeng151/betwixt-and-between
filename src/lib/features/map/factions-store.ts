// Factions store. Loaded once on map mount; mutations are write-through
// (server first, then update local store). Behaves like worldMaps + the
// other map-scoped stores in this folder.

import { writable } from 'svelte/store';
import { errorMessage } from '$lib/util/api-error-message.js';

export type Faction = {
	id: string;
	userId: string | null;
	name: string;
	color: string;
	styleJsonb: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
};

export type FactionInput = {
	name: string;
	color: string;
	styleJsonb?: Record<string, unknown> | null;
};

function createFactionStore() {
	const store = writable<Faction[]>([]);

	async function load(): Promise<void> {
		const res = await fetch('/api/factions');
		if (!res.ok) throw new Error(`Failed to load factions: ${await errorMessage(res)}`);
		store.set((await res.json()) as Faction[]);
	}

	async function create(input: FactionInput): Promise<Faction> {
		const res = await fetch('/api/factions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`Failed to create faction: ${await errorMessage(res)}`);
		const created = (await res.json()) as Faction;
		store.update((rows) => [...rows, created]);
		return created;
	}

	async function update(id: string, patch: Partial<FactionInput>): Promise<Faction> {
		const res = await fetch(`/api/factions/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (!res.ok) throw new Error(`Failed to update faction: ${await errorMessage(res)}`);
		const updated = (await res.json()) as Faction;
		store.update((rows) => rows.map((r) => (r.id === id ? updated : r)));
		return updated;
	}

	async function remove(id: string): Promise<{ dependentEventCount: number }> {
		const res = await fetch(`/api/factions/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete faction: ${await errorMessage(res)}`);
		const result = (await res.json()) as { dependentEventCount: number };
		store.update((rows) => rows.filter((r) => r.id !== id));
		return result;
	}

	function reset(): void {
		store.set([]);
	}

	return {
		subscribe: store.subscribe,
		load,
		create,
		update,
		delete: remove,
		reset
	};
}

export const factions = createFactionStore();
