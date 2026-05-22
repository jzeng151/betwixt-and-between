import type { RelationshipType } from '$lib/server/db/schema.js';

/**
 * Whether each relationship type is directed (A → B is meaningful and
 * distinct from B → A) or symmetric (A ↔ B; direction doesn't matter
 * semantically). Drives traversal: directed edges only walk in their
 * declared direction; symmetric edges walk both ways.
 *
 * Symmetric relationships:
 *   - allied_with — allyship is mutual
 *   - rivals      — rivalry is mutual
 *
 * Directed relationships:
 *   - takes_place_at — Event AT Location
 *   - caused_by      — effect ← cause
 *   - located_at     — Character AT Location
 *   - note_of        — Note ATTACHED-TO any entity
 *   - part_of        — Location PART-OF Location (child → parent)
 *
 * Record<RelationshipType, ...> forces an exhaustiveness check at compile
 * time: adding a new RelationshipType to schema.ts breaks this file
 * until classified.
 */
export const DIRECTION: Record<RelationshipType, 'directed' | 'symmetric'> = {
	allied_with: 'symmetric',
	rivals: 'symmetric',
	other: 'symmetric',
	takes_place_at: 'directed',
	caused_by: 'directed',
	located_at: 'directed',
	note_of: 'directed',
	part_of: 'directed'
};
