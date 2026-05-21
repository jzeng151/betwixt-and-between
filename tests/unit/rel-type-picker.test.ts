import { describe, it, expect } from 'vitest';
import {
  pickDefaultRelType,
  type RelationshipLike
} from '../../src/lib/features/graph/rel-type-picker.js';
import { REL_TYPES } from '../../src/lib/relationship-colors.js';

const A = 'entity-a';
const B = 'entity-b';

function rel(fromId: string, toId: string, type: string): RelationshipLike {
  return { fromId, toId, type: type as RelationshipLike['type'] };
}

describe('pickDefaultRelType', () => {
  it('returns the first REL_TYPES entry when nothing exists', () => {
    const picked = pickDefaultRelType([], A, B);
    expect(picked).toBe(REL_TYPES[0]);
  });

  it('skips a type already used in the same direction (A→B)', () => {
    const picked = pickDefaultRelType([rel(A, B, 'allied_with')], A, B);
    expect(picked).not.toBe('allied_with');
  });

  it('regression (Greptile P1): skips a type used in the REVERSE direction (B→A)', () => {
    // B→A allied_with already exists. User now drags A→B. The picker
    // must NOT suggest allied_with — otherwise the save creates a
    // distinct row (DB UNIQUE is directional) and the fan-out group
    // (undirected pair-key) renders two visually identical edges of
    // the same type/color.
    const picked = pickDefaultRelType([rel(B, A, 'allied_with')], A, B);
    expect(picked).not.toBe('allied_with');
  });

  it('skips multiple used types regardless of direction', () => {
    const picked = pickDefaultRelType(
      [
        rel(A, B, 'allied_with'),
        rel(B, A, 'rivals'),
        rel(A, B, 'takes_place_at')
      ],
      A,
      B
    );
    expect(picked).not.toBe('allied_with');
    expect(picked).not.toBe('rivals');
    expect(picked).not.toBe('takes_place_at');
  });

  it('falls back to the form default when every type is used in either direction', () => {
    // Saturate every type in either direction; the function falls back
    // to the form's classic default (the first entry in REL_TYPES) so
    // the user sees something selected and the save attempt surfaces
    // the UNIQUE constraint error.
    const all: RelationshipLike[] = REL_TYPES.map((t) => rel(A, B, t));
    const picked = pickDefaultRelType(all, A, B);
    expect(picked).toBe('allied_with');
  });

  it('ignores relationships involving other entities', () => {
    const picked = pickDefaultRelType(
      [rel('entity-c', 'entity-d', 'allied_with')],
      A,
      B
    );
    expect(picked).toBe('allied_with');
  });
});
