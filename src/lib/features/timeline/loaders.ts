// Cross-store reload helpers for timeline mutations.
//
// Most Timeline / ActsHeader mutations (create / delete / reorder Acts and
// Scenes, drop targets, scene-form saves) change BOTH the entity tree AND
// the intervals projection on the server. The server returns OK; the client
// then needs to refresh both stores to see the updated state.
//
// Naming the operation lets callers say "this mutation invalidates the
// timeline view" instead of repeating the two-store reload contract at
// every catch / finally site.

import { entities } from '$lib/stores/entities.js';
import { intervals as intervalsStore } from '$lib/features/timeline/intervals-store.js';

/** Reload entities + intervals in parallel. Resolves once both have settled. */
export async function refreshTimelineStores(): Promise<void> {
	await Promise.all([entities.load(), intervalsStore.load()]);
}
