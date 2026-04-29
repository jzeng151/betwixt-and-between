// Module-level in-flight draft tracker for EditableField text drafts.
// Used by the draft-preview toast (D16/14A): if an entity is deleted while
// the user is mid-keystroke in another window, we surface their last-typed
// text so they can copy it back.
//
// Keyed by (entityId, field). Cleared on field commit/cancel/unmount.

const drafts = new Map<string, Map<string, string>>();

export function setDraft(entityId: string, field: string, text: string): void {
	const inner = drafts.get(entityId) ?? new Map();
	inner.set(field, text);
	drafts.set(entityId, inner);
}

export function clearDraft(entityId: string, field: string): void {
	const inner = drafts.get(entityId);
	if (!inner) return;
	inner.delete(field);
	if (inner.size === 0) drafts.delete(entityId);
}

export function clearAllDraftsFor(entityId: string): void {
	drafts.delete(entityId);
}

/**
 * Get the longest non-empty draft for an entity. Pick longest because it's
 * the user's most-developed thought; ties broken by insertion order.
 * Returns null when nothing was being typed.
 */
export function getDraftPreview(entityId: string): { field: string; text: string } | null {
	const inner = drafts.get(entityId);
	if (!inner) return null;
	let best: { field: string; text: string } | null = null;
	for (const [field, text] of inner) {
		const t = text.trim();
		if (!t) continue;
		if (!best || t.length > best.text.length) best = { field, text: t };
	}
	return best;
}
