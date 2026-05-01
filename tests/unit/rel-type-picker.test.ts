import { describe, it, expect } from 'vitest';
import {
  pickDefaultRelType,
  type RelationshipLike
} from '../../src/lib/graph/rel-type-picker.js';
import { REL_TYPES } from '../../src/lib/relationship-colors.js';

const A = 'entity-a';
const B = 'entity-b';

function rel(fromId: string, toId: string, type: string): RelationshipLike {
  return { fromId, toId, type: type as RelationshipLike['type'] };
}

describe('pickDefaultRelType', () => {
  it('returns the first non-appears_in type when nothing exists', () => {
    const picked = pickDefaultRelType([], A, B);
    // First non-appears_in type in REL_TYPES.
    const expected = REL_TYPES.find((t) => t !== 'appears_in')!;
    expect(picked).toBe(expected);
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
        rel(A, B, 'mentor_of')
      ],
      A,
      B
    );
    expect(picked).not.toBe('allied_with');
    expect(picked).not.toBe('rivals');
    expect(picked).not.toBe('mentor_of');
  });

  it('never suggests appears_in (deprecated at the picker)', () => {
    // Saturate every non-appears_in type in BOTH directions; the
    // function still must not return appears_in. Falls back to the
    // form's classic default instead.
    const all: RelationshipLike[] = [];
    for (const t of REL_TYPES) {
      if (t === 'appears_in') continue;
      all.push(rel(A, B, t));
    }
    const picked = pickDefaultRelType(all, A, B);
    expect(picked).not.toBe('appears_in');
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
