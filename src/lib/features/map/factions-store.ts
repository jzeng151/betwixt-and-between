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
		const body = (await res.json()) as { rows: Faction[]; truncated: boolean };
		store.set(body.rows);
		if (body.truncated) console.warn('factions list truncated at server cap');
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

	async function countDependents(id: string): Promise<number> {
		const res = await fetch(`/api/factions/${id}/dependents`);
		if (!res.ok) throw new Error(`Failed to count dependents: ${await errorMessage(res)}`);
		const result = (await res.json()) as { dependentEventCount: number };
		return result.dependentEventCount;
	}

	async function remove(id: string): Promise<void> {
		const res = await fetch(`/api/factions/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete faction: ${await errorMessage(res)}`);
		store.update((rows) => rows.filter((r) => r.id !== id));
	}

	function reset(): void {
		store.set([]);
	}

	return {
		subscribe: store.subscribe,
		load,
		create,
		update,
		countDependents,
		delete: remove,
		reset
	};
}

export const factions = createFactionStore();
