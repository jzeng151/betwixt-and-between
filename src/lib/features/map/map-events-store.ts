// map_events store. Append-only by design (no PATCH endpoint); "editing"
// an event means delete + insert. Scoped per world_map like the anchors
// store.

import { writable } from 'svelte/store';
import { errorMessage } from '$lib/util/api-error-message.js';

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
	kind: 'transfer_region';
	payloadJsonb: unknown;
	sourceEventId?: string | null;
};

function createMapEventsStore() {
	const store = writable<MapEvent[]>([]);

	async function load(mapId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/events`);
		if (!res.ok) throw new Error(`Failed to load events: ${await errorMessage(res)}`);
		store.set((await res.json()) as MapEvent[]);
	}

	async function create(mapId: string, input: EventInput): Promise<MapEvent> {
		const res = await fetch(`/api/maps/${mapId}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`Failed to create event: ${await errorMessage(res)}`);
		const created = (await res.json()) as MapEvent;
		store.update((rows) =>
			[...rows, created].sort((a, b) => a.tPosition - b.tPosition || a.id.localeCompare(b.id))
		);
		return created;
	}

	async function remove(mapId: string, eventId: string): Promise<void> {
		const res = await fetch(`/api/maps/${mapId}/events/${eventId}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Failed to delete event: ${await errorMessage(res)}`);
		store.update((rows) => rows.filter((r) => r.id !== eventId));
	}

	function reset(): void {
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
