// Radial layout: place focal nodes at (or near) the canvas center
// and arrange the remaining displayed nodes on a ring around them.
// Used by FocusedGraph as the first-open seed when no per-window
// positions exist yet — produces a graph-like layout instead of the
// linear cascade-row of GraphCanvas's grid auto-place fallback.
//
// All positions are returned in canvas coordinates anchored to a
// notional 600×400 viewport-equivalent (the typical FG default size
// minus chrome). The caller doesn't need to know the actual viewport
// size — fitView in GraphCanvas centers/zooms whatever bag we hand it.
export interface NodePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NODE_W = 120;
const NODE_H = 32;
const CENTER_X = 320;
const CENTER_Y = 200;

// Minimum ring radius: large enough that a single peripheral node
// reads as "around the focal" rather than "right next to it." Scales
// upward with peripheral count so labels don't overlap on the ring.
const MIN_RING_R = 160;

function angleSlice(count: number, i: number, offset = 0): number {
  if (count <= 0) return 0;
  return offset + (2 * Math.PI * i) / count;
}

/**
 * Compute a radial layout for a displayed-entity set.
 *
 *   - 0 focals, N peripherals → circle of N around the center
 *   - 1 focal,  N peripherals → focal at center, N on a single ring
 *   - K focals, N peripherals → focals on a small inner ring,
 *                               N on a larger outer ring
 *
 * Ring radius scales with peripheral count to avoid label overlap.
 * Rotates the ring by π/2 so the first node sits at the top of the
 * circle (more visually balanced than first-on-the-right).
 */
export function radialLayout(
  focalIds: Set<string>,
  displayIds: string[]
): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  const focals = displayIds.filter((id) => focalIds.has(id));
  const peripheral = displayIds.filter((id) => !focalIds.has(id));

  // ~22 canvas units of arc per node gives ~1.4× NODE_W of spacing.
  // Clamped to [MIN_RING_R, 280].
  const ringR = Math.max(
    MIN_RING_R,
    Math.min(280, peripheral.length * 22)
  );
  // Inner ring (only used with 2+ focals); kept small relative to
  // outer ring so the cluster reads as "the central group."
  const focalR = focals.length > 1 ? Math.max(40, focals.length * 18) : 0;

  // Half-π offset so the first node sits at the top of the circle.
  const ringOffset = -Math.PI / 2;

  if (focals.length === 0) {
    // Edge case: no focals selected. Lay everyone on a single ring.
    peripheral.forEach((id, i) => {
      const a = angleSlice(peripheral.length, i, ringOffset);
      positions[id] = {
        x: CENTER_X + ringR * Math.cos(a),
        y: CENTER_Y + ringR * Math.sin(a),
        w: NODE_W,
        h: NODE_H
      };
    });
    return positions;
  }

  if (focals.length === 1) {
    positions[focals[0]] = { x: CENTER_X, y: CENTER_Y, w: NODE_W, h: NODE_H };
  } else {
    focals.forEach((id, i) => {
      const a = angleSlice(focals.length, i, ringOffset);
      positions[id] = {
        x: CENTER_X + focalR * Math.cos(a),
        y: CENTER_Y + focalR * Math.sin(a),
        w: NODE_W,
        h: NODE_H
      };
    });
  }

  peripheral.forEach((id, i) => {
    const a = angleSlice(peripheral.length, i, ringOffset);
    positions[id] = {
      x: CENTER_X + ringR * Math.cos(a),
      y: CENTER_Y + ringR * Math.sin(a),
      w: NODE_W,
      h: NODE_H
    };
  });

  return positions;
}
