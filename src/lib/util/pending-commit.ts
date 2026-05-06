/**
 * Pending-commit registry — dirty-draft tracker used by chip-click
 * navigation to drain in-flight EditableField textareas BEFORE swapping
 * EntityDetail context.
 *
 * Background: the Wiki app's wiki-nav context (slice 7) lets an
 * EntityLink chip click swap the Wiki content area to another entity.
 * EditableField commits drafts on blur. If a user is editing a Body
 * textarea and clicks a chip, the navigate-then-blur sequence runs
 * commit AFTER the EntityDetail unmounts — at which point the textarea
 * reference is stale, the entity context is wrong, and the draft can
 * be silently lost or PATCHed against the new entity.
 *
 * Solution: each EditableField with a dirty draft registers itself
 * here while focused. Before navigating, EntityLink calls
 * drainPendingCommit() — every registered handle's commitNow() runs
 * to completion (settling the PATCH against the still-mounted entity)
 * before the await resolves.
 *
 * The registry is a Set of opaque handles, not DOM-mediated, so it
 * survives Svelte 5 component-tree topology changes and is unit-testable
 * in jsdom without actual focus/blur events.
 */

export interface EditableFieldHandle {
	/** Commits the current draft (if dirty) to the entity store and
	 *  resolves once the PATCH settles. No-op if draft is clean. Errors
	 *  bubble — caller chooses whether to await or fire-and-forget. */
	commitNow: () => Promise<void>;
}

const REGISTRY = new Set<EditableFieldHandle>();

export function registerDirtyField(handle: EditableFieldHandle): void {
	REGISTRY.add(handle);
}

export function unregisterDirtyField(handle: EditableFieldHandle): void {
	REGISTRY.delete(handle);
}

/** Awaits every currently-registered handle's commitNow() in parallel.
 *  Returns once all settle (resolved or rejected). Failures are
 *  swallowed — the navigation must proceed regardless; surfaced errors
 *  appear in the source EditableField via its own saveError state. */
export async function drainPendingCommit(): Promise<void> {
	if (REGISTRY.size === 0) return;
	const handles = [...REGISTRY];
	await Promise.allSettled(handles.map((h) => h.commitNow()));
}

/** Test helper: clear all registered handles. */
export function _resetPendingCommitRegistry(): void {
	REGISTRY.clear();
}

/** Test helper: how many handles are currently registered. */
export function _pendingCommitSize(): number {
	return REGISTRY.size;
}
