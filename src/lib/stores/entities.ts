import { get, writable } from 'svelte/store';
import type { EntityType } from '$lib/server/db/schema.js';
import { intervals as intervalsStore } from '$lib/features/timeline/intervals-store.js';
import { relationships } from '$lib/stores/relationships.js';

export const entityLoadStatus = writable<'idle' | 'loading' | 'ready' | 'error'>('idle');
export const entitySnapshotReady = writable(false);

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
	let loadPromise: Promise<void> | null = null;
	let rollbackPromise: Promise<void> | null = null;
	let replacementPromise: Promise<void> | null = null;
	let loadGeneration = 0;
	// Per-entity update sequence. updateEntity applies an optimistic merge then
	// installs the PATCH response; without sequencing, two edits to the same row
	// racing on the wire can land out of order — e.g. a style save and an
	// adjacent is_asset toggle both send full `data`, and a slow earlier
	// response reinstalls a server row missing the other edit's field until a
	// reload (Codex P2, PR #59). Track the newest in-flight seq per id and only
	// apply the server row / roll back if our call is still the latest for it.
	let updateSeq = 0;
	const latestUpdate = new Map<string, number>();
	// Per-entity PATCH chain. Like the placement store, multiple edits to one
	// entity's `data` (e.g. a style save then an adjacent is_asset toggle) each
	// send a full `data` object; the latestUpdate guard only suppresses applying
	// a stale response locally — it does NOT stop the requests racing on the
	// wire, so the DATABASE could keep the older `data` and the newer field
	// disappears on reload (Codex P2). Chain each PATCH behind the prior in-flight
	// one for the same id so requests reach the API in call order.
	const updateChains = new Map<string, Promise<unknown>>();
	function invalidateLoadAfterMutation() {
		loadGeneration++;
		loadPromise = null;
		entityLoadStatus.set(get(entitySnapshotReady) ? 'ready' : 'idle');
	}
	function markMutationReady() {
		invalidateLoadAfterMutation();
		entitySnapshotReady.set(true);
		entityLoadStatus.set('ready');
	}

	function load({ fresh = false, rollback = false, replacement = false }: {
		fresh?: boolean;
		rollback?: boolean;
		replacement?: boolean;
	} = {}): Promise<void> {
		if (fresh && !rollback && rollbackPromise) return rollbackPromise.then(() => load({ fresh: true }));
		if (fresh && !replacement && replacementPromise) return replacementPromise;
		if (loadPromise && !fresh) return loadPromise;
		const generation = ++loadGeneration;
		entityLoadStatus.set('loading');
		const request = (async () => {
			const res = await fetch('/api/entities');
			if (!res.ok) throw new Error(`entities.load failed: ${res.status} ${await res.text()}`);
			const data: Entity[] = await res.json();
			if (generation !== loadGeneration) return;
			set(data);
			entitySnapshotReady.set(true);
			entityLoadStatus.set('ready');
		})().catch((error) => {
			if (generation === loadGeneration) entityLoadStatus.set('error');
			throw error;
		});
		loadPromise = request;
		return request.finally(() => {
			if (loadPromise === request) loadPromise = null;
		});
	}
	function rollbackSnapshot(): Promise<void> {
		if (rollbackPromise) return rollbackPromise;
		const request = load({ fresh: true, rollback: true });
		const pending = request.finally(() => {
			if (rollbackPromise === pending) rollbackPromise = null;
		});
		rollbackPromise = pending;
		return pending;
	}
	function replaceSnapshot(): Promise<void> {
		const request = load({ fresh: true, replacement: true });
		const pending = request.finally(() => {
			if (replacementPromise === pending) replacementPromise = null;
		});
		replacementPromise = pending;
		return pending;
	}
	function refreshAfterMutation(): Promise<void> {
		return replacementPromise ?? replaceSnapshot();
	}
	async function settleSnapshotBeforeCreate(): Promise<boolean> {
		const pendingRollback = rollbackPromise;
		let needsFreshSnapshot = loadPromise !== null && !pendingRollback;
		if (pendingRollback) await pendingRollback.catch(() => { needsFreshSnapshot = true; });
		if (loadPromise) needsFreshSnapshot = true;
		return needsFreshSnapshot;
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
		const needsFreshSnapshot = await settleSnapshotBeforeCreate();
		markMutationReady();
		update((all) => [...all, created]);
		if (needsFreshSnapshot) {
			entitySnapshotReady.set(true);
			await replaceSnapshot().catch(() => {});
		}
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
		const needsFreshSnapshot = await settleSnapshotBeforeCreate();
		markMutationReady();
		update((all) => [...all, ...created]);
		if (needsFreshSnapshot) {
			entitySnapshotReady.set(true);
			await replaceSnapshot().catch(() => {});
		}
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
		const seq = ++updateSeq;
		latestUpdate.set(id, seq);
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

		// Serialize the network write behind any in-flight PATCH for this same
		// entity so requests reach the API in submission order (see updateChains).
		// The optimistic merge above already ran synchronously, so the UI stays
		// instant; only the fetch is gated.
		const prior = updateChains.get(id) ?? Promise.resolve();
		const run = (async () => {
			await prior.catch(() => {});
			const res = await fetch(`/api/entities/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (!res.ok) throw new Error(await res.text());
			return (await res.json()) as Entity;
		})();
		updateChains.set(id, run.catch(() => {}));

		let updated: Entity;
		try {
			updated = await run;
		} catch (err) {
			// Only roll back via load() if a newer edit hasn't superseded ours —
			// otherwise the reload would discard the newer optimistic value too.
			if (latestUpdate.get(id) === seq) {
				latestUpdate.delete(id);
				updateChains.delete(id);
				await rollbackSnapshot();
			}
			throw err;
		}
		const pendingSnapshot = rollbackPromise;
		const pendingGeneration = loadGeneration;
		let needsFreshSnapshot = replacementPromise !== null;
		if (pendingSnapshot) await pendingSnapshot.catch(() => { needsFreshSnapshot = true; });
		if (pendingGeneration !== loadGeneration) needsFreshSnapshot = true;
		invalidateLoadAfterMutation();
		// Whether THIS patch was a structural Act/Scene change that the server
		// recomputes interval bounds for. Captured before the supersede check so a
		// later non-structural edit (e.g. a rename) can't make us skip the refresh.
		const wasStructural =
			(patch.position !== undefined || patch.parentId !== undefined) &&
			(updated.type === 'Act' || updated.type === 'Scene');

		// If a newer edit to this row was issued meanwhile, don't install our
		// server row (it would clobber the newer optimistic value). But still
		// refresh intervals if our patch was structural — the server already
		// recomputed bounds, and the superseding edit (a rename) won't have, so
		// the timeline would otherwise stay stale until a full reload (Codex P2).
		if (latestUpdate.get(id) !== seq) {
			// Safe to load even if the superseding edit also refreshes: intervals
			// is a global store with its own loadToken, so concurrent loads can't
			// clobber a newer view and the latest response wins. Worst case is one
			// redundant fetch when two structural edits race — never stale data.
			// Relationships ride along: the server recomputes scene-anchored
			// caused_by start/end positions on a scene-within-act mutation too
			// (Slice 5 PR-D), and the graph click-to-jump reads $relationships,
			// so a stale store would jump to the old scene fraction (Codex P2).
			if (wasStructural) await Promise.all([intervalsStore.load(), relationships.load()]);
			if (needsFreshSnapshot) await replaceSnapshot().catch(() => {});
			return updated;
		}
		latestUpdate.delete(id);
		updateChains.delete(id);
		update((all) => all.map((e) => (e.id === id ? updated : e)));
		if (needsFreshSnapshot) await replaceSnapshot().catch(() => {});
		// Position/parentId changes on Act/Scene cascade to intervals on the
		// server (sibling reorder + recompute, or scene cross-act move) AND to
		// scene-anchored relationship positions (Slice 5 PR-D). Keep both stores
		// in sync so the timeline bars and the graph click-to-jump agree.
		if (wasStructural) {
			await Promise.all([intervalsStore.load(), relationships.load()]);
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
			await rollbackSnapshot();
			throw err;
		}
		if (!res.ok) {
			await rollbackSnapshot();
			throw new Error(await res.text());
		}
		const pendingSnapshot = rollbackPromise;
		const pendingGeneration = loadGeneration;
		let needsFreshSnapshot = replacementPromise !== null;
		if (pendingSnapshot) await pendingSnapshot.catch(() => { needsFreshSnapshot = true; });
		if (pendingGeneration !== loadGeneration) needsFreshSnapshot = true;
		invalidateLoadAfterMutation();
		update((all) => all.filter((e) => e.id !== id));
		if (needsFreshSnapshot) await replaceSnapshot().catch(() => {});
		// Server-side delete cascades to intervals (entity_id / start_act_id /
		// end_act_id are all CASCADE) and recomputes survivor positions for
		// Act/Scene deletes. It also cascade-deletes relationships on an endpoint
		// delete and recomputes / re-anchors scene-scoped relationship positions
		// on an Act delete (incl. ?moveScenesTo). Both stores are separate
		// writables, so reload both — otherwise survivor bars render at pre-delete
		// positions and the graph keeps phantom or stale-positioned edges.
		await Promise.all([intervalsStore.load(), relationships.load()]);
	}

	return { subscribe, load, refreshAfterMutation, createEntity, createEntities, updateEntity, deleteEntity };
}

export const entities = createEntityStore();
