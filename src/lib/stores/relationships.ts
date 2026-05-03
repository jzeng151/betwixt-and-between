import { writable } from 'svelte/store';
import type { RelationshipType } from '$lib/server/db/schema.js';

export type Relationship = {
	id: string;
	fromId: string;
	toId: string;
	type: RelationshipType;
	label: string | null;
	startPosition: number | null;
	endPosition: number | null;
	revealedAtPosition: number | null;
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
		label?: string,
		opts?: { startActId?: string; endActId?: string; revealedAtPosition?: number | null }
	): Promise<Relationship> {
		const res = await fetch('/api/relationships', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fromId, toId, type, label: label ?? null, ...opts })
		});
		if (!res.ok) throw new Error(await res.text());
		const created: Relationship = await res.json();
		update((all) => [...all, created]);
		return created;
	}

	async function updateRelationship(
		id: string,
		fields: {
			type?: RelationshipType;
			label?: string | null;
			startActId?: string | null;
			endActId?: string | null;
			revealedAtPosition?: number | null;
		}
	): Promise<Relationship> {
		const res = await fetch(`/api/relationships/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(fields)
		});
		if (!res.ok) throw new Error(await res.text());
		const updated: Relationship = await res.json();
		update((all) => all.map((r) => (r.id === id ? updated : r)));
		return updated;
	}

	async function deleteRelationship(id: string): Promise<void> {
		update((all) => all.filter((r) => r.id !== id));
		let res: Response;
		try {
			res = await fetch(`/api/relationships/${id}`, { method: 'DELETE' });
		} catch (err) {
			// Network error before any response — recover the optimistic remove.
			await load();
			throw err;
		}
		if (!res.ok) {
			await load();
			throw new Error(await res.text());
		}
	}

	return { subscribe, load, createRelationship, updateRelationship, deleteRelationship };
}

export const relationships = createRelationshipStore();
