// map_events store. Append-only by design (no PATCH endpoint); "editing"
// an event means delete + insert. Scoped per world_map like the anchors
// store.

import { get, writable } from 'svelte/store';
import { errorMessage } from '$lib/util/api-error-message.js';
import { mapAnchorsStore } from './map-anchors-store.js';
import type { EventKind } from './projection.js';

export type MapEvent = {
	id: string;
	worldMapId: string;
	tPosition: number;
	kind: string;
	payloadJsonb: unknown;
	sourceEventId: string | null;
	createdAt: string;
	// Groups chunked-stroke events under one undo command (map_events.command_id).
	// NULL = standalone event. The server returns it on every row; the client
	// uses it to predict the undo group for optimistic undo.
	commandId?: string | null;
};

export type EventInput = {
	tPosition: number;
	kind: EventKind;
	payloadJsonb: unknown;
	sourceEventId?: string | null;
	// Slice 3 B5 — groups chunked paint_cells events under one undo
	// command. Pass a UUIDv4 shared across all chunks of a brush stroke;
	// omit for standalone events.
	commandId?: string | null;
};

// codex PR review: server orders ties by (tPosition, createdAt, id) — see
// projection.ts → compareCreatedAt + projectState's applicable.sort. The
// client's insert-and-sort path was using (tPosition, id) only, so a redo
// at the same tPosition folded in a different order than the server
// until the next load. Match the server tiebreak exactly.
function compareEvents(a: MapEvent, b: MapEvent): number {
	if (a.tPosition !== b.tPosition) return a.tPosition - b.tPosition;
	const am = Date.parse(a.createdAt);
	const bm = Date.parse(b.createdAt);
	if (am !== bm) return am - bm;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function createMapEventsStore() {
	const store = writable<MapEvent[]>([]);
	// See map-anchors-store.ts for the rationale. Codex P1 on PR #55.
	let lastLoadedMapId: string | null = null;
	// Monotonic load token (mirrors map-anchors-store). lastLoadedMapId alone has an
	// A→B→A ABA hole: a slow load(A) resolving after an applyPrefetched(A) commit
	// passes the map-id check and clobbers the committed bundle. applyPrefetched bumps
	// this so any older in-flight load is dropped regardless of map (Codex PR #72 #949).
	let loadToken = 0;

	// Slice 2 D3 (T7) — client-side redo stack. Server holds no redo
	// state; an undone event lives here until it's redone or until a
	// new event is authored (which clears the stack). Scoped to the
	// currently-loaded map.
	const redoStore = writable<MapEvent[]>([]);
	let redoStackForMapId: string | null = null;

	// Serialize undo/redo so spamming them can't fire concurrent POSTs. The
	// server's undo pops the latest LIVE event; N in-flight optimistic undos
	// would race, and out-of-order responses made each call's reconciliation
	// re-add another call's predicted group (strokes "came back" while the
	// redo stack corrupted). Running one op at a time keeps each prediction
	// matched to the row the server actually pops. A single (un-spammed) op
	// still runs on the next microtask — visually instant.
	let opChain: Promise<void> = Promise.resolve();
	function enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = opChain.then(task);
		opChain = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	// Pages through /api/maps/[id]/events until next_cursor is null. See
	// map-anchors-store.ts for the lastLoadedMapId rationale (Codex P1 on
	// PR #55).
	async function load(mapId: string): Promise<void> {
		lastLoadedMapId = mapId;
		const token = ++loadToken;
		const stale = () => lastLoadedMapId !== mapId || token !== loadToken;
		// Switching maps invalidates the redo stack.
		if (redoStackForMapId !== mapId) {
			redoStackForMapId = mapId;
			redoStore.set([]);
		}
		const collected: MapEvent[] = [];
		let cursor: string | null = null;
		do {
			const url = cursor
				? `/api/maps/${mapId}/events?after=${encodeURIComponent(cursor)}`
				: `/api/maps/${mapId}/events`;
			const res = await fetch(url);
			if (stale()) return;
			if (!res.ok) throw new Error(`Failed to load events: ${await errorMessage(res)}`);
			const body = (await res.json()) as { rows: MapEvent[]; next_cursor: string | null };
			if (stale()) return;
			collected.push(...body.rows);
			cursor = body.next_cursor;
		} while (cursor != null);
		if (stale()) return;
		store.set(collected);
	}

	// See map-anchors-store.ts for the rationale. Codex P1 on PR #55
	// (commit be1f09c): mutation responses honor lastLoadedMapId so an
	// in-flight POST against map A doesn't merge into map B's store
	// after the user switches.

	// create() shares the same serialization chain as undo()/redo(): an author
	// event in flight (paint chunk, transfer_region) must settle before an undo
	// reads the store to predict what to pop. Otherwise pressing Ctrl+Z right
	// after a paint — before its POST commits — let undo pop the PREVIOUS event
	// (the new one isn't live server-side yet) while the just-painted cell
	// stayed. Serializing also keeps optimism instant: with the chain idle the
	// task runs on the next microtask, so the optimistic insert is immediate.
	function create(mapId: string, input: EventInput): Promise<MapEvent> {
		return enqueue(() => createImpl(mapId, input));
	}
	async function createImpl(mapId: string, input: EventInput): Promise<MapEvent> {
		// Optimistic insert: render the painted cells immediately instead of
		// waiting for the POST round-trip. Without this the brush had a visible
		// lag between releasing the gesture and the terrain appearing (the POST
		// to Neon is the latency). We append a provisional row keyed by a temp
		// id so the projection folds it on the next tick, then swap it for the
		// authoritative server row on success / drop it on failure.
		const tempId = `temp:${crypto.randomUUID()}`;
		const optimistic: MapEvent = {
			id: tempId,
			worldMapId: mapId,
			tPosition: input.tPosition,
			kind: input.kind,
			payloadJsonb: input.payloadJsonb,
			sourceEventId: input.sourceEventId ?? null,
			createdAt: new Date().toISOString(),
			commandId: input.commandId ?? null
		};
		if (lastLoadedMapId === mapId) {
			store.update((rows) => [...rows, optimistic].sort(compareEvents));
		}
		let res: Response;
		try {
			res = await fetch(`/api/maps/${mapId}/events`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(input)
			});
		} catch (err) {
			// Network failure — roll back the optimistic row.
			if (lastLoadedMapId === mapId) {
				store.update((rows) => rows.filter((r) => r.id !== tempId));
			}
			throw err;
		}
		if (!res.ok) {
			if (lastLoadedMapId === mapId) {
				store.update((rows) => rows.filter((r) => r.id !== tempId));
			}
			throw new Error(`Failed to create event: ${await errorMessage(res)}`);
		}
		// codex P2 (PR #58): the server drops synthetic anchors at/after this
		// event's tPosition and returns their ids. Evict them from the anchors
		// store so projectState doesn't keep picking a stale snapshot that
		// excludes the just-authored event. Strip the field before storing —
		// it's not part of the MapEvent shape.
		const { invalidatedAnchorIds, ...created } = (await res.json()) as MapEvent & {
			invalidatedAnchorIds?: string[];
		};
		if (lastLoadedMapId !== mapId) return created;
		if (invalidatedAnchorIds?.length) mapAnchorsStore.dropLocal(mapId, invalidatedAnchorIds);
		// Swap the provisional row for the server row in one update so the
		// terrain never flickers off between the two.
		store.update((rows) => [...rows.filter((r) => r.id !== tempId), created].sort(compareEvents));
		// New event authored — invalidate the redo stack (D3 contract).
		if (redoStackForMapId === mapId) redoStore.set([]);
		return created;
	}

	async function remove(mapId: string, eventId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/events/${eventId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete event: ${await errorMessage(res)}`);
		if (lastLoadedMapId !== mapId) return;
		store.update((rows) => rows.filter((r) => r.id !== eventId));
		// codex P2 (PR #58): deleteMapEvent soft-deletes the event AND invalidates
		// synthetic anchors that folded it (same invalidation as undo). The 204
		// response carries nothing, so refetch the anchor set to drop the stale
		// synthetic snapshot — else projectState keeps rendering the deleted
		// terrain/ownership until a reload. Best-effort (mirrors undo()).
		void mapAnchorsStore.load(mapId).catch((err) => {
			console.error('anchor re-sync after event delete failed; projection may be stale until reload', err);
		});
	}

	// Slice 2 D3 (T7) — pop the latest live event from the server, push
	// onto the redo stack. Surfaces 422 ("No events to undo") to callers
	// unchanged so the UI can disable the undo button on empty stack.
	function undo(mapId: string): Promise<MapEvent | null> {
		return enqueue(() => undoImpl(mapId));
	}
	async function undoImpl(mapId: string): Promise<MapEvent | null> {
		// Optimistic undo: predict the command group the server will pop — the
		// latest live event plus any events sharing its commandId — and remove
		// it from the store NOW so the terrain updates without waiting for the
		// round-trip (the "slight delay" QA flagged). Reconcile to the server's
		// authoritative set on response; roll the prediction back if the server
		// had nothing to undo or the request failed.
		const current = get(store);
		// Nothing locally to undo → don't POST (avoids the 422 spam when undo
		// is hammered past the start of history). The Undo button + Ctrl+Z both
		// no-op cleanly. Serialization above means `current` already reflects
		// every prior undo in the queue.
		if (lastLoadedMapId === mapId && current.length === 0) return null;
		const latestLocal = current.length ? current[current.length - 1] : null;
		let predicted: MapEvent[] = [];
		if (latestLocal && lastLoadedMapId === mapId) {
			const gid = latestLocal.commandId ?? null;
			predicted = gid ? current.filter((r) => (r.commandId ?? null) === gid) : [latestLocal];
			const ids = new Set(predicted.map((r) => r.id));
			store.update((rows) => rows.filter((r) => !ids.has(r.id)));
		}
		const rollback = () => {
			if (lastLoadedMapId === mapId && predicted.length) {
				store.update((rows) => [...rows, ...predicted].sort(compareEvents));
			}
		};

		let res: Response;
		try {
			res = await fetch(`/api/maps/${mapId}/events/undo`, { method: 'POST' });
		} catch (err) {
			rollback();
			throw err;
		}
		if (res.status === 422) {
			rollback();
			return null;
		}
		if (!res.ok) {
			rollback();
			throw new Error(`Failed to undo: ${await errorMessage(res)}`);
		}
		// Slice 3 B5: server returns an array. Length 1 for standalone events;
		// length N for chunked brush strokes that share a command_id.
		const undone = (await res.json()) as MapEvent[];
		if (undone.length === 0) {
			rollback();
			return null;
		}
		const undoneIds = new Set(undone.map((e) => e.id));
		// Latest popped event (commit DESC) is what callers historically
		// got back — preserve that for return-shape compatibility.
		const latest = undone[0];
		if (lastLoadedMapId !== mapId) return latest;
		// Reconcile the optimistic removal with the server's authoritative set:
		// drop every server-undone row, and restore any row we removed
		// optimistically that the server did NOT actually undo (prediction
		// mismatch — rare, but never silently lose an event).
		store.update((rows) => {
			const next = rows.filter((r) => !undoneIds.has(r.id));
			for (const r of predicted) {
				if (!undoneIds.has(r.id) && !next.some((x) => x.id === r.id)) next.push(r);
			}
			return next.sort(compareEvents);
		});
		// codex P2 (PR #58): undo also invalidates synthetic anchors
		// server-side (undoLatestMapEvent runs the same invalidation as the
		// write paths). The /events/undo response is contractually an array of
		// event rows only, so — unlike create/redo which evict by returned id —
		// refetch the canonical anchor set to drop any synthetic anchor whose
		// snapshot folded a now-undone event. Otherwise projectState keeps
		// picking the stale snapshot and the undone terrain/ownership stays
		// visible until a full reload. load() honors lastLoadedMapId. Best
		// effort — a failed re-sync only means the stale snapshot lingers
		// until the next reload, so swallow rather than fail the undo.
		void mapAnchorsStore.load(mapId).catch((err) => {
			console.error('anchor re-sync after undo failed; projection may be stale until reload', err);
		});
		// Push each undone row onto the redo stack individually. Grouped
		// redo (replaying the whole stroke with a fresh command_id) lands
		// with the brush UX in PR C; for now redo pops one event at a
		// time and the user sees the chunks come back individually.
		if (redoStackForMapId === mapId) {
			redoStore.update((stack) => [...stack, ...undone]);
		} else {
			redoStackForMapId = mapId;
			redoStore.set([...undone]);
		}
		return latest;
	}

	// Re-POSTs the most recently undone event. Server has no redo state;
	// this creates a fresh row (new id + created_at, same t_position +
	// payload). Returns null if the redo stack is empty for this map.
	function redo(mapId: string): Promise<MapEvent | null> {
		return enqueue(() => redoImpl(mapId));
	}
	async function redoImpl(mapId: string): Promise<MapEvent | null> {
		if (redoStackForMapId !== mapId) return null;
		let popped: MapEvent | undefined;
		redoStore.update((stack) => {
			popped = stack[stack.length - 1];
			return stack.slice(0, -1);
		});
		if (!popped) return null;
		const poppedRow = popped;
		// Optimistic: re-add the event to the store NOW (temp id) so the terrain
		// reappears without waiting for the re-POST (the redo delay QA flagged).
		// Swapped for the server row on success; on failure remove it and push
		// the event back onto the redo stack so the user can retry.
		const tempId = `temp:${crypto.randomUUID()}`;
		const optimistic: MapEvent = {
			...poppedRow,
			id: tempId,
			createdAt: new Date().toISOString()
		};
		if (lastLoadedMapId === mapId) {
			store.update((rows) => [...rows, optimistic].sort(compareEvents));
		}
		const rollback = () => {
			if (lastLoadedMapId === mapId) {
				store.update((rows) => rows.filter((r) => r.id !== tempId));
			}
			redoStore.update((stack) => [...stack, poppedRow]);
		};

		// `create` would clear the redo stack on success — we just popped
		// from it, so the clear is a no-op. Use the raw POST so the
		// behavior stays explicit.
		let res: Response;
		try {
			res = await fetch(`/api/maps/${mapId}/events`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tPosition: poppedRow.tPosition,
					kind: poppedRow.kind,
					payloadJsonb: poppedRow.payloadJsonb,
					sourceEventId: poppedRow.sourceEventId
				})
			});
		} catch (err) {
			rollback();
			throw err;
		}
		if (!res.ok) {
			rollback();
			throw new Error(`Failed to redo: ${await errorMessage(res)}`);
		}
		// Redo re-POSTs the event, so it can invalidate synthetic anchors too
		// (codex P2, PR #58) — evict them client-side just like create().
		const { invalidatedAnchorIds, ...created } = (await res.json()) as MapEvent & {
			invalidatedAnchorIds?: string[];
		};
		if (lastLoadedMapId !== mapId) return created;
		if (invalidatedAnchorIds?.length) mapAnchorsStore.dropLocal(mapId, invalidatedAnchorIds);
		// Swap the provisional row for the server row in one update.
		store.update((rows) => [...rows.filter((r) => r.id !== tempId), created].sort(compareEvents));
		return created;
	}

	// Cycle staged-prefetch (Codex PR #72 #505) — see map-anchors-store.ts. `prefetch`
	// pages a map's events without touching the store; `applyPrefetched` installs a
	// buffered set as canonical (recording lastLoadedMapId so an in-flight load() of
	// another map no-ops, and resetting the redo stack since switching maps does).
	async function prefetch(mapId: string): Promise<MapEvent[]> {
		const collected: MapEvent[] = [];
		let cursor: string | null = null;
		do {
			const url = cursor
				? `/api/maps/${mapId}/events?after=${encodeURIComponent(cursor)}`
				: `/api/maps/${mapId}/events`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Failed to load events: ${await errorMessage(res)}`);
			const body = (await res.json()) as { rows: MapEvent[]; next_cursor: string | null };
			collected.push(...body.rows);
			cursor = body.next_cursor;
		} while (cursor != null);
		return collected;
	}
	function applyPrefetched(mapId: string, rows: MapEvent[]): void {
		lastLoadedMapId = mapId;
		++loadToken; // supersede any in-flight load (incl. a same-map A→B→A ABA load)
		if (redoStackForMapId !== mapId) {
			redoStackForMapId = mapId;
			redoStore.set([]);
		}
		store.set(rows);
	}

	function reset(): void {
		lastLoadedMapId = null;
		redoStackForMapId = null;
		redoStore.set([]);
		store.set([]);
	}

	return {
		subscribe: store.subscribe,
		load,
		prefetch,
		applyPrefetched,
		create,
		delete: remove,
		undo,
		redo,
		redoStack: { subscribe: redoStore.subscribe },
		reset
	};
}

export const mapEventsStore = createMapEventsStore();
