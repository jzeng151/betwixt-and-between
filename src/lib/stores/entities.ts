import { writable } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';
import { intervals as intervalsStore } from './intervals.js';

export type Entity = {
	id: string;
	type: EntityType;
	name: string;
	// jsonb on the server (T8a port). Object shape — no JSON.parse at the
	// boundary anymore. Field schema varies by entity type (Act has goal /
	// stakes / turning point; Event has outcome; Scene has sensory anchor;
	// etc.) — narrowing to a tagged union is a future polish.
	data: Record<string, unknown>;
	parentId: string | null;
	position: number | null;
	createdAt: string | Date;
	updatedAt: string | Date;
};

function createEntityStore() {
	const { subscribe, set, update } = writable<Entity[]>([]);

	async function load() {
		const res = await fetch('/api/entities');
		const data: Entity[] = await res.json();
		set(data);
	}

	/**
	 * Create an entity. Locked 2026-04-29 in /plan-eng-review (D19/Issue 13A) —
	 * options form takes `{data, parentId, position}`. The 2-arg form
	 * `createEntity(type, name)` stays backward-compatible.
	 */
	async function createEntity(
		type: EntityType,
		name: string,
		options?: { data?: unknown; parentId?: string | null; position?: number | null }
	): Promise<Entity> {
		const body: Record<string, unknown> = { type, name };
		if (options?.data !== undefined) body.data = options.data;
		if (options?.parentId !== undefined) body.parentId = options.parentId;
		if (options?.position !== undefined) body.position = options.position;

		const res = await fetch('/api/entities', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(await res.text());
		const created: Entity = await res.json();
		update((all) => [...all, created]);
		return created;
	}

	/**
	 * Atomic multi-entity create via /api/entities/batch (D21/Issue 20A).
	 * Used by break-into-scenes and any future bulk-create flow. All-or-nothing
	 * server-side; on success, all created entities are appended to the store
	 * in one update().
	 */
	async function createEntities(
		items: Array<{
			type: EntityType;
			name: string;
			data?: unknown;
			parentId?: string | null;
			position?: number | null;
		}>
	): Promise<Entity[]> {
		const res = await fetch('/api/entities/batch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ entities: items })
		});
		if (!res.ok) throw new Error(await res.text());
		const created: Entity[] = await res.json();
		update((all) => [...all, ...created]);
		return created;
	}

	/**
	 * Patch an entity. Locked 2026-04-29 — patch type now accepts
	 * `parentId` and `position` (D19/Issue 13A). Optimistic update applies
	 * all fields immediately; rollback via load() on !res.ok.
	 */
	async function updateEntity(
		id: string,
		patch: {
			name?: string;
			data?: unknown;
			parentId?: string | null;
			position?: number;
		}
	): Promise<Entity> {
		const optimistic = patch;
		update((all) =>
			all.map((e) =>
				e.id === id
					? {
							...e,
							...(optimistic.name !== undefined ? { name: optimistic.name } : {}),
							...(optimistic.data !== undefined
								? { data: optimistic.data as Record<string, unknown> }
								: {}),
							...(optimistic.parentId !== undefined ? { parentId: optimistic.parentId } : {}),
							...(optimistic.position !== undefined ? { position: optimistic.position } : {})
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
		// Position/parentId changes on Act/Scene cascade to intervals on the
		// server (sibling reorder + recompute, or scene cross-act move). Keep
		// the intervals store in sync.
		if (
			(patch.position !== undefined || patch.parentId !== undefined) &&
			(updated.type === 'Act' || updated.type === 'Scene')
		) {
			await intervalsStore.load();
		}
		return updated;
	}

	async function deleteEntity(id: string): Promise<void> {
		update((all) => all.filter((e) => e.id !== id));
		let res: Response;
		try {
			res = await fetch(`/api/entities/${id}`, { method: 'DELETE' });
		} catch (err) {
			// Network error before any response — recover the optimistic remove.
			await load();
			throw err;
		}
		if (!res.ok) {
			await load();
			throw new Error(await res.text());
		}
		// Server-side delete cascades to intervals (entity_id / start_act_id /
		// end_act_id are all CASCADE) and recomputes survivor positions for
		// Act/Scene deletes. The intervals store is a separate writable so
		// reload it here — otherwise survivor bars render at pre-delete
		// positions and overflow when N (act count) decreased.
		await intervalsStore.load();
	}

	return { subscribe, load, createEntity, createEntities, updateEntity, deleteEntity };
}

export const entities = createEntityStore();
