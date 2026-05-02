// Pins REL_EDGE_STYLE — per-relationship-type stroke patterns used by
// GraphCanvas to give each edge a second visual channel beyond color.
// `Record<RelationshipType, EdgeStyle>` already enforces exhaustiveness
// at compile time, but a runtime assertion catches refactor regressions
// (e.g. someone deleting an entry to fix a TypeScript narrowing issue).
import { describe, it, expect } from 'vitest';
import { REL_EDGE_STYLE, REL_TYPES } from '../../src/lib/relationship-colors.js';

describe('REL_EDGE_STYLE', () => {
  it('has an entry for every RelationshipType in REL_TYPES', () => {
    for (const type of REL_TYPES) {
      expect(REL_EDGE_STYLE[type]).toBeDefined();
    }
  });

  it('every entry has the three required style fields', () => {
    for (const type of REL_TYPES) {
      const style = REL_EDGE_STYLE[type];
      expect(style).toHaveProperty('dasharray');
      expect(style).toHaveProperty('width');
      expect(style).toHaveProperty('arrow');
      expect(typeof style.width).toBe('number');
      expect(typeof style.arrow).toBe('boolean');
      // dasharray is `string | null` — not undefined.
      expect(style.dasharray === null || typeof style.dasharray === 'string').toBe(true);
    }
  });

  it('symmetric types do not carry an arrowhead', () => {
    // Symmetric rel types (allied_with, rivals) shouldn't show direction.
    expect(REL_EDGE_STYLE.allied_with.arrow).toBe(false);
    expect(REL_EDGE_STYLE.rivals.arrow).toBe(false);
  });

  it('directed types whose direction carries strong meaning show an arrow', () => {
    expect(REL_EDGE_STYLE.mentor_of.arrow).toBe(true);
    expect(REL_EDGE_STYLE.caused_by.arrow).toBe(true);
  });

  it('uses three distinct dash families (solid / dashed / dotted)', () => {
    const families = new Set<string>();
    for (const type of REL_TYPES) {
      const d = REL_EDGE_STYLE[type].dasharray;
      families.add(d ?? 'solid');
    }
    // Expect at least 3 distinct values across the 8 types.
    expect(families.size).toBeGreaterThanOrEqual(3);
  });
});
