import { playhead } from './playhead-store.js';
import type { Relationship } from '$lib/stores/relationships.js';

/**
 * WM3 Slice 5 D5 / ADR 0006 — EventChain click-to-jump.
 *
 * Clicking a `caused_by` edge (the canonical EventChain link) jumps the playhead
 * to where the causal link is scoped: the relationship row's `startPosition`.
 * A timeless edge (no scope → `startPosition == null`) is a deliberate no-op.
 *
 * Pure and surface-agnostic: the same helper backs both graph surfaces
 * (StoryGraph, FocusedGraph) and, in PR-C, the map causal-edge layer — one
 * jump semantics, every surface. Returns whether it jumped so a caller can
 * choose a fallback.
 */
export function jumpToCause(
	rel: Pick<Relationship, 'type' | 'startPosition'> | undefined | null
): boolean {
	if (!rel || rel.type !== 'caused_by') return false;
	if (rel.startPosition == null) return false; // timeless link — nothing to jump to
	playhead.scrubTo(rel.startPosition);
	return true;
}
