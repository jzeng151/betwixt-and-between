// Pins the FocusedGraph mode rules. The scenario uses Prestige-shaped
// edges (a Character with directed edges INCOMING from scenes, plus
// undirected rivalry/alliance edges). The original fixture used pov_of
// and mentor_of; both were cut by the 2026-05-20 audit (Step 5.5,
// drizzle/0011_data_model_cleanup.sql). Replaced here with caused_by
// since the test only exercises the directed/undirected traversal
// mechanic and visible-set does not validate type endpoints.
//
// Locked semantics:
//   - their_worlds: undirected 1-hop union
//   - shared:       undirected intersection of every focal's 1-hop
//                   set; identical to their_worlds with one focal
//   - reachable:    undirected 2-hop union (NOT transitive closure)
import { describe, it, expect } from 'vitest';
import { computeVisibleSet } from '../../src/lib/features/graph/visible-set.js';
import type { Edge } from '../../src/lib/features/graph/traversal.js';

const BORDEN = 'borden';
const ANGIER = 'angier';
const CUTTER = 'cutter';
const SARAH = 'sarah';
const TESLA = 'tesla';
const EDISON = 'edison';
const SCENE_A = 'scene-apprenticeship';
const SCENE_B = 'scene-julia-incident';

const EDGES: Edge[] = [
  // Directed edges from scenes INTO Borden — only reachable undirected.
  // Tests the directed-edge bug fix (caused_by stands in for the cut
  // pov_of; the type identity does not affect traversal semantics).
  { fromId: SCENE_A, toId: BORDEN, type: 'caused_by' },
  { fromId: SCENE_B, toId: BORDEN, type: 'caused_by' },
  // Symmetric rivalry/alliance — walks both ways either way.
  { fromId: BORDEN, toId: ANGIER, type: 'rivals' },
  { fromId: BORDEN, toId: SARAH, type: 'allied_with' },
  // Cutter directs both rivals (multi-rel pair from Cutter, but the
  // shared-mode test cares about Cutter being ADJACENT to both).
  // caused_by stands in for the cut mentor_of.
  { fromId: CUTTER, toId: BORDEN, type: 'caused_by' },
  { fromId: CUTTER, toId: ANGIER, type: 'caused_by' },
  // Tesla directs Angier; Edison rivals Tesla. Tests 2-hop reaching
  // Edison from Borden via Angier→Tesla→Edison (3 hops, should NOT
  // be in 2-hop set).
  { fromId: TESLA, toId: ANGIER, type: 'caused_by' },
  { fromId: TESLA, toId: EDISON, type: 'rivals' }
];

describe('computeVisibleSet — their_worlds (undirected 1-hop)', () => {
  it('includes neighbors via outgoing edges', () => {
    const out = computeVisibleSet('their_worlds', new Set([BORDEN]), EDGES);
    expect(out.has(ANGIER)).toBe(true);
    expect(out.has(SARAH)).toBe(true);
  });

  it('includes scenes whose directed edge points AT the focal (undirected fix)', () => {
    const out = computeVisibleSet('their_worlds', new Set([BORDEN]), EDGES);
    expect(out.has(SCENE_A)).toBe(true);
    expect(out.has(SCENE_B)).toBe(true);
  });

  it('does NOT include 2-hop neighbors', () => {
    const out = computeVisibleSet('their_worlds', new Set([BORDEN]), EDGES);
    // Tesla is reachable via Angier (Borden ↔ Angier ↔ Tesla) but
    // that's 2 hops away.
    expect(out.has(TESLA)).toBe(false);
    expect(out.has(EDISON)).toBe(false);
  });
});

describe('computeVisibleSet — shared (undirected intersection)', () => {
  it('with one focal, identical to that focal\'s 1-hop set', () => {
    const single = new Set([BORDEN]);
    const shared = computeVisibleSet('shared', single, EDGES);
    const oneHop = computeVisibleSet('their_worlds', single, EDGES);
    expect([...shared].sort()).toEqual([...oneHop].sort());
  });

  it('with two focals, returns only entities adjacent to BOTH', () => {
    const out = computeVisibleSet('shared', new Set([BORDEN, ANGIER]), EDGES);
    // Cutter is mentor of BOTH → in the intersection.
    expect(out.has(CUTTER)).toBe(true);
    // Sarah is allied only with Borden → NOT in the intersection.
    expect(out.has(SARAH)).toBe(false);
    // Tesla is mentor of Angier only → NOT in the intersection.
    expect(out.has(TESLA)).toBe(false);
  });
});

describe('computeVisibleSet — reachable (undirected 2-hop)', () => {
  it('includes 1-hop neighbors', () => {
    const out = computeVisibleSet('reachable', new Set([BORDEN]), EDGES);
    expect(out.has(ANGIER)).toBe(true);
    expect(out.has(SARAH)).toBe(true);
    expect(out.has(SCENE_A)).toBe(true);
  });

  it('includes 2-hop neighbors (mentors of allies, etc.)', () => {
    const out = computeVisibleSet('reachable', new Set([BORDEN]), EDGES);
    // Tesla is at distance 2: Borden ↔ Angier ↔ Tesla.
    expect(out.has(TESLA)).toBe(true);
  });

  it('does NOT walk 3+ hops (avoids hairball-style transitive closure)', () => {
    const out = computeVisibleSet('reachable', new Set([BORDEN]), EDGES);
    // Edison is at distance 3: Borden ↔ Angier ↔ Tesla ↔ Edison.
    expect(out.has(EDISON)).toBe(false);
  });
});

describe('computeVisibleSet — empty focal set', () => {
  it('returns empty for every mode', () => {
    const empty = new Set<string>();
    expect(computeVisibleSet('their_worlds', empty, EDGES).size).toBe(0);
    expect(computeVisibleSet('shared', empty, EDGES).size).toBe(0);
    expect(computeVisibleSet('reachable', empty, EDGES).size).toBe(0);
  });
});
