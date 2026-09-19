/** Drafts and queued saves drain before navigation changes their context.
 * Story switching requires every commit to succeed before leaving the document. */

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

/** Entity-link navigation tolerates failures; story switching requires success. */
export async function drainPendingCommit(requireSuccess = false): Promise<void> {
	if (REGISTRY.size === 0) return;
	const handles = [...REGISTRY];
	const results = await Promise.allSettled(handles.map((h) => h.commitNow()));
	if (requireSuccess) {
		const failed = results.find((result) => result.status === 'rejected');
		if (failed?.status === 'rejected') throw failed.reason;
	}
}

/** Test helper: clear all registered handles. */
export function _resetPendingCommitRegistry(): void {
	REGISTRY.clear();
}

/** Test helper: how many handles are currently registered. */
export function _pendingCommitSize(): number {
	return REGISTRY.size;
}
