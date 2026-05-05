import { writable } from 'svelte/store';

/**
 * Timeline row-filter state. Set from the Wiki context menu's "Open
 * focused timeline" action; the Timeline app subscribes and dims rows
 * whose entityId doesn't match.
 *
 * `null` means no filter — every row renders at full opacity.
 *
 * Phase 1 wiki-rework slice 4. The store is intentionally tiny so other
 * surfaces (e.g. a future "filter to character" affordance on the
 * Character editor) can write to it without coordinating through the
 * window store.
 */
export interface TimelineFilter {
	entityId: string | null;
}

function createTimelineFilter() {
	const { subscribe, set, update } = writable<TimelineFilter>({ entityId: null });

	return {
		subscribe,
		set,
		update,
		/** Convenience: focus on a single entity. */
		focus(entityId: string) {
			set({ entityId });
		},
		/** Convenience: clear the filter so all rows render full-opacity. */
		clear() {
			set({ entityId: null });
		}
	};
}

export const timelineFilter = createTimelineFilter();
