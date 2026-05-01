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
 *   - appears_in     (DEPRECATED for new writes, kept for legacy reads)
 *   - takes_place_at — Event AT Location
 *   - caused_by      — effect ← cause
 *   - mentor_of      — mentor → mentee
 *   - located_at     — Character AT Location
 *   - pov_of         — Event/Scene FROM-THE-POV-OF Character
 *
 * Record<RelationshipType, ...> forces an exhaustiveness check at compile
 * time: adding a new RelationshipType to schema.ts breaks this file
 * until classified.
 */
export const DIRECTION: Record<RelationshipType, 'directed' | 'symmetric'> = {
	allied_with: 'symmetric',
	rivals: 'symmetric',
	appears_in: 'directed',
	takes_place_at: 'directed',
	caused_by: 'directed',
	mentor_of: 'directed',
	located_at: 'directed',
	pov_of: 'directed'
};
