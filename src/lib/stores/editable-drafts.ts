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

