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

	// Pages through /api/factions until next_cursor is null. Single-user
	// dogfooding scale tops out in the low hundreds; pagination is a
	// future-proofing fix for the Slice 1b 500-row cap (Slice 2 D5).
	async function load(): Promise<void> {
		const collected: Faction[] = [];
		let cursor: string | null = null;
		do {
			const url = cursor
				? `/api/factions?after=${encodeURIComponent(cursor)}`
				: '/api/factions';
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Failed to load factions: ${await errorMessage(res)}`);
			const body = (await res.json()) as { rows: Faction[]; next_cursor: string | null };
			collected.push(...body.rows);
			cursor = body.next_cursor;
		} while (cursor != null);
		store.set(collected);
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
