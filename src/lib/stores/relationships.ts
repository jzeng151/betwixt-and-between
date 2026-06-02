import { writable } from 'svelte/store';
import type { RelationshipType } from '$lib/server/db/schema.js';

export type Relationship = {
	id: string;
	fromId: string;
	toId: string;
	type: RelationshipType;
	label: string | null;
	startActId: string | null;
	startSceneId: string | null;
	endActId: string | null;
	endSceneId: string | null;
	startPosition: number | null;
	endPosition: number | null;
	revealedAtPosition: number | null;
};

function createRelationshipStore() {
	const { subscribe, set, update } = writable<Relationship[]>([]);

	// Monotonic load token. Structural Act/Scene edits each fire a load() after
	// their PATCH; concurrent edits can have an earlier request resolve LAST and
	// clobber newer positions with stale ones (the graph click-to-jump reads
	// these bounds). Stamp each load and only commit if it's still the latest —
	// out-of-order responses from superseded loads are dropped (Codex P2).
	let loadSeq = 0;

	async function load() {
		const seq = ++loadSeq;
		const res = await fetch('/api/relationships');
		if (!res.ok) throw new Error(`relationships.load failed: ${res.status} ${await res.text()}`);
		const data: Relationship[] = await res.json();
		if (seq !== loadSeq) return; // a newer load() started — drop this stale result
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
			startSceneId?: string | null;
			endActId?: string | null;
			endSceneId?: string | null;
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
