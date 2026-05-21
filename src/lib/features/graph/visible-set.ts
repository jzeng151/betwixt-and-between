// Maps a FocusedGraph viewMode to its traversal output.
//
// The interesting rule lives here, not in the component: every mode
// walks edges as undirected (a focal Character should reach a Scene
// that is `pov_of` THEM, not just nodes the Character points AT), and
// structural exclusion is OFF for all modes (1-hop and 2-hop don't
// risk runaway fan-out the way transitive `reachable` did).
//
//   - their_worlds: undirected 1-hop union — every entity directly
//                   connected to any focal node.
//   - shared:       undirected intersection — entities adjacent to
//                   EVERY focal. Identical to their_worlds when there's
//                   only one focal (handled inside sharedNeighbors).
//   - reachable:    undirected 2-hop union — focals' direct neighbors
//                   AND those neighbors' direct neighbors. Replaces the
//                   prior transitive-closure semantic that produced
//                   hairballs.
import { sharedNeighbors, oneHopUnion, type Edge } from './traversal.js';
import type { FocusedGraphMode } from '$lib/stores/windows.js';

export function computeVisibleSet(
  mode: FocusedGraphMode,
  focalSetIds: Set<string>,
  edges: Edge[]
): Set<string> {
  if (focalSetIds.size === 0) return new Set<string>();
  const opts = { undirected: true };

  if (mode === 'shared') return sharedNeighbors(focalSetIds, edges, opts);

  if (mode === 'reachable') {
    // 2-hop union: focals' 1-hop neighbors AND those neighbors' 1-hop
    // neighbors. We expand the input set by the first hop, then call
    // oneHopUnion again on the expanded set; the result naturally
    // contains both the 1-hop and 2-hop layers.
    const oneHop = oneHopUnion(focalSetIds, edges, opts);
    const expanded = new Set<string>([...focalSetIds, ...oneHop]);
    return oneHopUnion(expanded, edges, opts);
  }

  // their_worlds (default): undirected 1-hop union.
  return oneHopUnion(focalSetIds, edges, opts);
}
