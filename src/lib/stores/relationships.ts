import { writable } from 'svelte/store';
import type { RelationshipType } from '$lib/server/db/schema.js';

export type Relationship = {
	id: string;
	fromId: string;
	toId: string;
	type: RelationshipType;
	label: string | null;
};

function createRelationshipStore() {
	const { subscribe, set, update } = writable<Relationship[]>([]);

	async function load() {
		const res = await fetch('/api/relationships');
		const data: Relationship[] = await res.json();
		set(data);
	}

	async function createRelationship(
		fromId: string,
		toId: string,
		type: RelationshipType,
		label?: string
	): Promise<Relationship> {
		const res = await fetch('/api/relationships', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fromId, toId, type, label: label ?? null })
		});
		if (!res.ok) throw new Error(await res.text());
		const created: Relationship = await res.json();
		update((all) => [...all, created]);
		return created;
	}

	async function deleteRelationship(id: string): Promise<void> {
		update((all) => all.filter((r) => r.id !== id));
		try {
			const res = await fetch(`/api/relationships/${id}`, { method: 'DELETE' });
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

	return { subscribe, load, createRelationship, deleteRelationship };
}

export const relationships = createRelationshipStore();
