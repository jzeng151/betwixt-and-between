// map_events store. Append-only by design (no PATCH endpoint); "editing"
// an event means delete + insert. Scoped per world_map like the anchors
// store.

import { writable } from 'svelte/store';
import { errorMessage } from '$lib/util/api-error-message.js';
import type { EventKind } from './projection.js';

export type MapEvent = {
	id: string;
	worldMapId: string;
	tPosition: number;
	kind: string;
	payloadJsonb: unknown;
	sourceEventId: string | null;
	createdAt: string;
};

export type EventInput = {
	tPosition: number;
	kind: EventKind;
	payloadJsonb: unknown;
	sourceEventId?: string | null;
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

	// Slice 2 D3 (T7) — client-side redo stack. Server holds no redo
	// state; an undone event lives here until it's redone or until a
	// new event is authored (which clears the stack). Scoped to the
	// currently-loaded map.
	const redoStore = writable<MapEvent[]>([]);
	let redoStackForMapId: string | null = null;

	// Pages through /api/maps/[id]/events until next_cursor is null. See
	// map-anchors-store.ts for the lastLoadedMapId rationale (Codex P1 on
	// PR #55).
	async function load(mapId: string): Promise<void> {
		lastLoadedMapId = mapId;
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
			if (lastLoadedMapId !== mapId) return;
			if (!res.ok) throw new Error(`Failed to load events: ${await errorMessage(res)}`);
			const body = (await res.json()) as { rows: MapEvent[]; next_cursor: string | null };
			if (lastLoadedMapId !== mapId) return;
			collected.push(...body.rows);
			cursor = body.next_cursor;
		} while (cursor != null);
		if (lastLoadedMapId !== mapId) return;
		store.set(collected);
	}

	// See map-anchors-store.ts for the rationale. Codex P1 on PR #55
	// (commit be1f09c): mutation responses honor lastLoadedMapId so an
	// in-flight POST against map A doesn't merge into map B's store
	// after the user switches.

	async function create(mapId: string, input: EventInput): Promise<MapEvent> {
		const res = await fetch(`/api/maps/${mapId}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`Failed to create event: ${await errorMessage(res)}`);
		const created = (await res.json()) as MapEvent;
		if (lastLoadedMapId !== mapId) return created;
		store.update((rows) => [...rows, created].sort(compareEvents));
		// New event authored — invalidate the redo stack (D3 contract).
		if (redoStackForMapId === mapId) redoStore.set([]);
		return created;
	}

	async function remove(mapId: string, eventId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/events/${eventId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete event: ${await errorMessage(res)}`);
		if (lastLoadedMapId !== mapId) return;
		store.update((rows) => rows.filter((r) => r.id !== eventId));
	}

	// Slice 2 D3 (T7) — pop the latest live event from the server, push
	// onto the redo stack. Surfaces 422 ("No events to undo") to callers
	// unchanged so the UI can disable the undo button on empty stack.
	async function undo(mapId: string): Promise<MapEvent | null> {
		const res = await fetch(`/api/maps/${mapId}/events/undo`, { method: 'POST' });
		if (res.status === 422) return null;
		if (!res.ok) throw new Error(`Failed to undo: ${await errorMessage(res)}`);
		// Slice 3 B5: server now returns an array. Length 1 for standalone
		// events (legacy); length N for chunked brush strokes that share a
		// command_id. All N rows are filtered from local state in one pass.
		const undone = (await res.json()) as MapEvent[];
		if (undone.length === 0) return null;
		const undoneIds = new Set(undone.map((e) => e.id));
		// Latest popped event (commit DESC) is what callers historically
		// got back — preserve that for return-shape compatibility.
		const latest = undone[0];
		if (lastLoadedMapId !== mapId) return latest;
		store.update((rows) => rows.filter((r) => !undoneIds.has(r.id)));
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
	async function redo(mapId: string): Promise<MapEvent | null> {
		if (redoStackForMapId !== mapId) return null;
		let popped: MapEvent | undefined;
		redoStore.update((stack) => {
			popped = stack[stack.length - 1];
			return stack.slice(0, -1);
		});
		if (!popped) return null;
		// `create` would clear the redo stack on success — we just popped
		// from it, so the clear is a no-op. Use the raw POST so the
		// behavior stays explicit.
		const res = await fetch(`/api/maps/${mapId}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tPosition: popped.tPosition,
				kind: popped.kind,
				payloadJsonb: popped.payloadJsonb,
				sourceEventId: popped.sourceEventId
			})
		});
		if (!res.ok) {
			// Restore the stack on failure so the user can retry.
			redoStore.update((stack) => [...stack, popped!]);
			throw new Error(`Failed to redo: ${await errorMessage(res)}`);
		}
		const created = (await res.json()) as MapEvent;
		if (lastLoadedMapId !== mapId) return created;
		store.update((rows) => [...rows, created].sort(compareEvents));
		return created;
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
		create,
		delete: remove,
		undo,
		redo,
		redoStack: { subscribe: redoStore.subscribe },
		reset
	};
}

export const mapEventsStore = createMapEventsStore();
