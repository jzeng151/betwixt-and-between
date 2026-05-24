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

function createMapEventsStore() {
	const store = writable<MapEvent[]>([]);
	// See map-anchors-store.ts for the rationale. Codex P1 on PR #55.
	let lastLoadedMapId: string | null = null;

	async function load(mapId: string): Promise<{ truncated: boolean }> {
		lastLoadedMapId = mapId;
		const res = await fetch(`/api/maps/${mapId}/events`);
		if (lastLoadedMapId !== mapId) return { truncated: false };
		if (!res.ok) throw new Error(`Failed to load events: ${await errorMessage(res)}`);
		const body = (await res.json()) as { rows: MapEvent[]; truncated: boolean };
		if (lastLoadedMapId !== mapId) return { truncated: false };
		store.set(body.rows);
		if (body.truncated) console.warn('events list truncated at server cap');
		// See map-anchors-store.ts for rationale (Codex P1 on PR #55).
		return { truncated: body.truncated };
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
		store.update((rows) =>
			[...rows, created].sort((a, b) => a.tPosition - b.tPosition || a.id.localeCompare(b.id))
		);
		return created;
	}

	async function remove(mapId: string, eventId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/events/${eventId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete event: ${await errorMessage(res)}`);
		if (lastLoadedMapId !== mapId) return;
		store.update((rows) => rows.filter((r) => r.id !== eventId));
	}

	function reset(): void {
		lastLoadedMapId = null;
		store.set([]);
	}

	return {
		subscribe: store.subscribe,
		load,
		create,
		delete: remove,
		reset
	};
}

export const mapEventsStore = createMapEventsStore();
