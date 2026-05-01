// Picks a sensible default relationship type when the user creates a new
// edge between two entities, skipping types that the same pair already
// uses. Extracted from StoryGraph.svelte so the bidirectional-skip
// invariant is unit-testable without component machinery.
//
// Why bidirectional: the DB's UNIQUE(from_id, to_id, type) is directional,
// so B→A allied_with and A→B allied_with are distinct rows and both
// inserts succeed. But the visual fan-out in <GraphCanvas> groups edges
// by an UNDIRECTED pair-key, so two same-type edges across the same pair
// render as visually identical parallel offset lines (Greptile P1 on
// PR #16). Skipping types already used in EITHER direction prevents that
// silent duplicate at the suggestion layer.
import { REL_TYPES } from '$lib/relationship-colors.js';
import type { RelationshipType } from '$lib/server/db/schema.js';

export interface RelationshipLike {
  fromId: string;
  toId: string;
  type: RelationshipType;
}

export function pickDefaultRelType(
  relationships: readonly RelationshipLike[],
  fromId: string,
  toId: string
): RelationshipType {
  const existing = new Set<RelationshipType>(
    relationships
      .filter(
        (r) =>
          (r.fromId === fromId && r.toId === toId) ||
          (r.fromId === toId && r.toId === fromId)
      )
      .map((r) => r.type)
  );
  for (const t of REL_TYPES) {
    // appears_in is deprecated at the API and is owned by intervals,
    // not direct picker creation.
    if (t === 'appears_in') continue;
    if (!existing.has(t)) return t;
  }
  // Saturated — fall back to the form's classic default. The save
  // attempt will fail with a UNIQUE constraint error, which is the
  // right signal to the user that no more types are available for
  // this pair.
  return 'allied_with';
}
