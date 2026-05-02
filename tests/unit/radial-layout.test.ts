// Pins the radial-layout helper used by FocusedGraph for first-open
// position seeding. Single focal sits at the canvas center; peripheral
// nodes ride a ring around it. Replaces the cascade-row look produced
// by GraphCanvas's grid auto-place fallback when no per-window seed
// exists.
import { describe, it, expect } from 'vitest';
import { radialLayout } from '../../src/lib/graph/radial-layout.js';

const FOCAL = 'focal';
const A = 'a';
const B = 'b';
const C = 'c';
const D = 'd';

const dist = (
  p: { x: number; y: number },
  q: { x: number; y: number }
): number => Math.hypot(p.x - q.x, p.y - q.y);

describe('radialLayout', () => {
  it('one focal sits at the canvas center', () => {
    const out = radialLayout(new Set([FOCAL]), [FOCAL]);
    // Single point — center coordinates are an internal constant; just
    // assert it sits at THE canvas's typical center area.
    expect(out[FOCAL].x).toBeGreaterThan(200);
    expect(out[FOCAL].x).toBeLessThan(450);
    expect(out[FOCAL].y).toBeGreaterThan(100);
    expect(out[FOCAL].y).toBeLessThan(300);
  });

  it('peripherals are equidistant from a single focal (within rounding)', () => {
    const out = radialLayout(new Set([FOCAL]), [FOCAL, A, B, C, D]);
    const center = { x: out[FOCAL].x, y: out[FOCAL].y };
    const ringDistances = [A, B, C, D].map((id) => dist(out[id], center));
    const r = ringDistances[0];
    for (const d of ringDistances) {
      expect(Math.abs(d - r)).toBeLessThan(0.001);
    }
  });

  it('peripherals are spread around the focal (not clustered on one side)', () => {
    const out = radialLayout(new Set([FOCAL]), [FOCAL, A, B, C, D]);
    const center = { x: out[FOCAL].x, y: out[FOCAL].y };
    // Each peripheral should be at a distinct angle. Sum the unit
    // vectors from center; for evenly-distributed N≥3 points around a
    // circle, the sum is ~zero (allowing tiny floating-point error).
    let sumX = 0;
    let sumY = 0;
    for (const id of [A, B, C, D]) {
      const dx = out[id].x - center.x;
      const dy = out[id].y - center.y;
      const r = Math.hypot(dx, dy);
      sumX += dx / r;
      sumY += dy / r;
    }
    expect(Math.abs(sumX)).toBeLessThan(0.001);
    expect(Math.abs(sumY)).toBeLessThan(0.001);
  });

  it('two focals are placed on a small inner ring, peripherals on outer', () => {
    const out = radialLayout(new Set([FOCAL, A]), [FOCAL, A, B, C, D]);
    // Inner-ring distance < outer-ring distance.
    const cx = (out[FOCAL].x + out[A].x) / 2;
    const cy = (out[FOCAL].y + out[A].y) / 2;
    const focalR = dist(out[FOCAL], { x: cx, y: cy });
    const peripheralR = dist(out[B], { x: cx, y: cy });
    expect(focalR).toBeLessThan(peripheralR);
  });

  it('zero focals → everyone on a single ring', () => {
    const out = radialLayout(new Set(), [A, B, C, D]);
    // All four should be equidistant from the canvas center.
    const center = {
      x: (Math.min(...[A, B, C, D].map((id) => out[id].x)) +
          Math.max(...[A, B, C, D].map((id) => out[id].x))) / 2,
      y: (Math.min(...[A, B, C, D].map((id) => out[id].y)) +
          Math.max(...[A, B, C, D].map((id) => out[id].y))) / 2
    };
    const ds = [A, B, C, D].map((id) => dist(out[id], center));
    const r = ds[0];
    for (const d of ds) {
      expect(Math.abs(d - r)).toBeLessThan(0.001);
    }
  });

  it('preserves NODE_W and NODE_H on every output entry', () => {
    const out = radialLayout(new Set([FOCAL]), [FOCAL, A, B]);
    for (const id of [FOCAL, A, B]) {
      expect(out[id].w).toBeGreaterThan(0);
      expect(out[id].h).toBeGreaterThan(0);
    }
  });

  it('empty input → empty output', () => {
    expect(radialLayout(new Set(), [])).toEqual({});
  });
});
