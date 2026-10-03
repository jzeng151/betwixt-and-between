import { expect, it, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { graphDiagram, graphCaption, graphBounds, type GraphCapture } from '$lib/features/whiteboard/graph-import.js';
import { boardDrafts, loadBoard, editBoard, saveBoard, uploadBoardImage, undoBoard } from '$lib/features/whiteboard/store.js';
import { emptyDocument } from '$lib/features/whiteboard/model.js';

const node = (x: number): GraphCapture['nodes'][number] => ({ id: crypto.randomUUID(), name: 'Mara', type: 'Character', x, y: 50, width: 120, height: 32,
  color: '#c8942a', fill: '#161920', border: '#c8942a', opacity: 1, dashed: false, font: '13px sans-serif', typeFont: '11px sans-serif', typeColor: '#aaaaaa' });
afterEach(() => { vi.unstubAllGlobals(); boardDrafts.set({}); });

it('imports only the captured projection, preserving reference targets, dimming, labels and separate parallel connectors', () => {
  const a = node(-200), b = { ...node(40), opacity: 0.18, dashed: true };
  const edge = { id: 'a', fromId: a.id, toId: b.id, x1: -140, y1: 66, x2: 100, y2: 66, color: '#c8942a', opacity: 0.45, width: 1.5, dash: '', arrow: true, label: 'Trusts', labelOpacity: 0.75, labelSize: 10 };
  const graph = { background: '#161920', nodes: [a, b], edges: [edge, { ...edge, id: 'b', fromId: b.id, toId: a.id, arrow: false, label: '', dash: '2 4', opacity: 0.2 }] };
  const imported = graphDiagram(graph, 'Clues', 'Story time: 1.5');
  const refs = imported.filter(e => e.type === 'reference'), connectors = imported.filter(e => e.type === 'connector');
  expect(refs.map(e => e.target)).toEqual([{ kind: 'entity', id: a.id }, { kind: 'entity', id: b.id }]);
  expect(refs.map(e => e.x)).toEqual([32, 512]);
  expect(refs[1]).toMatchObject({ opacity: 0.18, dashed: true });
  expect(connectors[0]).toMatchObject({ fromId: refs[0].id, toId: refs[1].id, text: 'Trusts', arrow: 'end' });
  expect(connectors[1]).toMatchObject({ fromId: refs[1].id, toId: refs[0].id, text: '', arrow: 'none', dashed: true, opacity: 0.2 });
  expect(Math.abs(connectors[0].bend!)).toBe(24); expect(connectors[1].bend).toBe(connectors[0].bend);
  expect(imported.slice(1).every(e => e.frameId === imported[0].id)).toBe(true);
  expect(graph.nodes[0].x).toBe(-200);
  expect(() => graphBounds({ ...graph, nodes: [] })).toThrow('no visible entities');
  expect(() => graphDiagram({ ...graph, nodes: [a, { ...b, x: 20000 }] }, 'Wide graph', '')).toThrow('Move its nodes closer or send a snapshot');
});

it('records source scope without turning zero story time into an empty label', () => {
  const caption = graphCaption('Focused graph: Mara', { time: 0, hardFilter: true, hideOutOfScope: false, ghostTrails: true, labels: false, relationships: ['allied_with'] });
  expect(caption).toContain('Story time: 0.'); expect(caption).toContain('Hide inactive edges');
  expect(caption).toContain('labels off'); expect(caption).toContain('allied with');
});

it('includes the full width of visible edge labels in snapshot bounds', () => {
  const a = node(0), b = { ...node(0), y: 250 };
  const graph: GraphCapture = { background: '#161920', nodes: [a, b], edges: [{ id: 'edge', fromId: a.id, toId: b.id,
    x1: 60, y1: 66, x2: 60, y2: 266, color: '#c8942a', opacity: 0.45, width: 1.5, dash: '', arrow: false,
    label: 'A long visible relationship', labelOpacity: 0.75, labelSize: 10 }] };
  const context = { font: '', measureText: () => ({ width: 600, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) } as unknown as CanvasRenderingContext2D;
  expect(graphBounds(graph, context)).toMatchObject({ x: -240, width: 600 });
  expect(graphBounds({ ...graph, edges: [{ ...graph.edges[0], label: '' }] }, context)).toMatchObject({ x: 0, width: 120 });
});

it('adds a snapshot, caption and frame as one undoable edit without overwriting concurrent board changes', async () => {
  const id = crypto.randomUUID(), upload = Promise.withResolvers<Response>();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id, name: 'Snapshot', revision: 0, document: emptyDocument() })).mockImplementationOnce(() => upload.promise).mockResolvedValue(Response.json({ revision: 1, name: 'Snapshot' }));
  vi.stubGlobal('fetch', fetcher); await loadBoard(id);
  const adding = uploadBoardImage(id, new File(['png'], 'Graph.png'), { x: 20, y: 30 }, 'Story time: 0. Ghost trails on.');
  const note = { id: crypto.randomUUID(), type: 'text' as const, x: 0, y: 0, width: 100, height: 50, color: '#c8942a', text: 'Concurrent edit' };
  editBoard(id, { ...emptyDocument(), elements: [note] });
  upload.resolve(Response.json({ url: `/api/maps/file/${crypto.randomUUID()}_1790395600000.png`, width: 800, height: 400 })); await adding;
  expect(get(boardDrafts)[id].document.elements.map(e => e.type)).toEqual(['text', 'frame', 'image', 'text']);
  expect(get(boardDrafts)[id].undo).toHaveLength(2);
  undoBoard(id); expect(get(boardDrafts)[id].document.elements).toEqual([note]); await saveBoard(id);
});

it('fits a tall snapshot and its source caption inside the document bounds', async () => {
  const id = crypto.randomUUID();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id, name: 'Tall graph', revision: 0, document: emptyDocument() }))
    .mockResolvedValueOnce(Response.json({ url: `/api/maps/file/${crypto.randomUUID()}_1790395600000.png`, width: 1, height: 4096 }))
    .mockResolvedValue(Response.json({ revision: 1, name: 'Tall graph' })));
  await loadBoard(id); await uploadBoardImage(id, new File(['png'], 'Tall.png'), { x: 0, y: 0 }, 'Source details. '.repeat(200));
  const elements = get(boardDrafts)[id].document.elements;
  expect(elements[0].height).toBe(20000);
  expect(elements.slice(1).every(e => e.y + e.height <= elements[0].height)).toBe(true);
  await saveBoard(id);
});
