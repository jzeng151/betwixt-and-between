import { expect, it, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import GraphCanvas from '$lib/features/graph/GraphCanvas.svelte';

vi.mock('$lib/features/whiteboard/graph-import.js', () => ({ colorHex: () => '#888888' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('captures projected nodes and suppresses mystery, ghost, and disabled labels before any export receives them', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const edge = { id: 'visible', fromId: 'mara', toId: 'oren', color: '#888888', label: 'Trust', dimmed: false, arrow: true };
  const view = render(GraphCanvas, {
    nodes: [{ id: 'mara', name: 'Mara', type: 'Character', aliasMember: true }, { id: 'oren', name: 'Oren', type: 'Character' }],
    edges: [edge, { ...edge, id: 'mystery', label: 'Secret identity', mysteryMode: true }, { ...edge, id: 'ghost', label: 'Future betrayal', ghostMode: 'future' }],
    dimmedNodes: new Set(['oren']), initialPositions: { mara: { x: 20, y: 30, w: 120, h: 32 }, oren: { x: 240, y: 60, w: 120, h: 32 } }
  });
  await tick();
  const captured = view.component.capture();
  expect(captured.nodes.map(n => [n.id, n.x, n.y, n.opacity, n.dashed])).toEqual([['mara', 20, 30, 1, true], ['oren', 240, 60, 0.18, false]]);
  expect(captured.edges.map(e => [e.id, e.label, e.arrow])).toEqual([['ghost', '', true], ['mystery', '', false], ['visible', 'Trust', true]]);
  await view.rerender({ showEdgeLabels: false });
  expect(view.component.capture().edges.every(e => e.label === '')).toBe(true);
  expect(captured.edges.find(e => e.id === 'visible')?.label).toBe('Trust');
});
