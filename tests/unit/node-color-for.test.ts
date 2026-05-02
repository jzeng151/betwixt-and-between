// Pins nodeColorFor: per-entity graph node color resolver. Mirrors
// timeline-v2-helpers.colorFor for Characters so the same entity reads
// in the same color in both Timeline and Graph surfaces.
import { describe, it, expect } from 'vitest';
import { nodeColorFor, NODE_COLOR } from '../../src/lib/relationship-colors.js';
import { CHARACTER_COLORS } from '../../src/lib/timeline-v2-helpers.js';
import type { EntityType } from '../../src/lib/server/db/schema.js';

const entity = (type: EntityType, data: Record<string, unknown> = {}) =>
  ({ type, data }) as const;

describe('nodeColorFor', () => {
  it('returns the entity custom color when data.color is a valid hex', () => {
    const c = nodeColorFor(entity('Character', { color: '#abcdef' }), 0);
    expect(c).toBe('#abcdef');
  });

  it('custom color takes precedence over both cycle and type-default', () => {
    // Pass a nonzero cycle index AND a type whose default differs.
    const c = nodeColorFor(entity('Location', { color: '#123456' }), 5);
    expect(c).toBe('#123456');
  });

  it("ignores invalid hex strings (falls through to cycle/default)", () => {
    const c = nodeColorFor(entity('Character', { color: 'not-a-hex' }), 0);
    expect(c).toBe(CHARACTER_COLORS[0]);
  });

  it('Characters cycle through CHARACTER_COLORS by index when no custom color', () => {
    expect(nodeColorFor(entity('Character'), 0)).toBe(CHARACTER_COLORS[0]);
    expect(nodeColorFor(entity('Character'), 3)).toBe(CHARACTER_COLORS[3]);
    // Wraps around.
    expect(nodeColorFor(entity('Character'), CHARACTER_COLORS.length)).toBe(
      CHARACTER_COLORS[0]
    );
  });

  it('non-Characters fall back to NODE_COLOR by type', () => {
    expect(nodeColorFor(entity('Location'))).toBe(NODE_COLOR.Location);
    expect(nodeColorFor(entity('Event'))).toBe(NODE_COLOR.Event);
    expect(nodeColorFor(entity('Act'))).toBe(NODE_COLOR.Act);
    expect(nodeColorFor(entity('Scene'))).toBe(NODE_COLOR.Scene);
    expect(nodeColorFor(entity('Note'))).toBe(NODE_COLOR.Note);
  });

  it('Character without an index falls back to NODE_COLOR.Character', () => {
    // E.g. Character not in the cycle list (shouldn't happen in practice
    // but the helper handles it).
    expect(nodeColorFor(entity('Character'))).toBe(NODE_COLOR.Character);
  });

  it('handles null / undefined data gracefully', () => {
    expect(nodeColorFor({ type: 'Character', data: null }, 0)).toBe(CHARACTER_COLORS[0]);
    expect(nodeColorFor({ type: 'Location', data: undefined })).toBe(
      NODE_COLOR.Location
    );
  });
});
