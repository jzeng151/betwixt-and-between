import { expect, it, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { documentError, emptyDocument, assignFrame, moveElements, deleteSelected, duplicateSelected, alignElements, isElementLocked, connectorGeometry, type BoardElement } from '$lib/features/whiteboard/model.js';
import { boardDrafts, boardList, loadBoards, loadBoard, editBoard, saveBoard, flushBoards, undoBoard, deleteBoard, uploadBoardImage } from '$lib/features/whiteboard/store.js';
import { failedWrites, flushPendingWrites } from '$lib/stores/pending-writes.js';
const element = (extra: Partial<BoardElement> = {}): BoardElement => ({ id: crypto.randomUUID(), type: 'sticky', x: 20, y: 50, width: 100, height: 100, color: '#c8942a', ...extra });
afterEach(() => { vi.unstubAllGlobals(); boardDrafts.set({}); failedWrites.set([]); });
it('assigns enclosed items to frames, moves members together, and unlinks items dragged out', () => {
  const frame = element({ type: 'frame', x: 0, y: 0, width: 500, height: 400 }); const note = element();
  const grouped = assignFrame([frame, note], note.id); expect(grouped[1].frameId).toBe(frame.id);
  const moved = moveElements(grouped, frame.id, -40, 100); expect(moved.map(e => [e.x, e.y])).toEqual([[-40, 100], [-20, 150]]);
  expect(assignFrame(moveElements(moved, note.id, 900, 0), note.id)[1].frameId).toBeNull();
});
it('validates strokes, image URLs, unique IDs, and frame membership', () => {
  const valid = { ...emptyDocument(), elements: [element()] }; expect(documentError(valid)).toBeNull();
  for (const patch of [{ type: 'arrow', points: 'bad' }, { type: 'image', url: 'javascript:alert(1)' }, { x: Infinity }, { frameId: crypto.randomUUID() }]) expect(documentError({ ...valid, elements: [{ ...valid.elements[0], ...patch }] })).toBeTruthy();
  expect(documentError({ ...valid, elements: [valid.elements[0], valid.elements[0]] })).toBeTruthy();
});
it('validates attached connectors, self-loops and presentation fields without accepting dangling or cyclic endpoints', () => {
  const first = element(), second = element(), line = element({ type: 'connector', fromId: first.id, toId: second.id, arrow: 'both', dashed: true, bend: -50, opacity: 0.4 });
  const document = { ...emptyDocument(), elements: [first, second, line] };
  expect(documentError(document)).toBeNull();
  expect(documentError({ ...document, elements: [first, { ...line, toId: first.id }] })).toBeNull();
  for (const patch of [{ fromId: undefined }, { toId: crypto.randomUUID() }, { toId: line.id }, { arrow: 'sideways' }, { dashed: 'yes' }, { bend: Infinity }, { opacity: -0.1 }, { locked: 'true' }]) {
    expect(documentError({ ...document, elements: [first, second, { ...line, ...patch }] })).toBeTruthy();
  }
  expect(documentError({ ...document, elements: [first, line, element({ type: 'connector', fromId: line.id, toId: first.id })] })).toBeTruthy();
  const cycle: Record<string, unknown> = { ...document }; cycle.extra = cycle;
  expect(documentError(cycle)).toBe('Invalid board document.');
});
it('moves a frame and selected children once while preserving locked elements and locked frame descendants', () => {
  const frame = element({ type: 'frame', x: 0, y: 0, width: 500, height: 400 });
  const child = element({ frameId: frame.id }), anchored = element({ frameId: frame.id, locked: true });
  const lockedFrame = element({ type: 'frame', locked: true }), protectedChild = element({ frameId: lockedFrame.id });
  const line = element({ type: 'connector', fromId: child.id, toId: anchored.id });
  const elements = [frame, child, anchored, lockedFrame, protectedChild, line];
  expect(moveElements(elements, elements.map(e => e.id), 10, -20).map(e => [e.x, e.y])).toEqual([[10, -20], [30, 30], [20, 50], [20, 50], [20, 50], [20, 50]]);
  expect(isElementLocked(elements, protectedChild.id)).toBe(true);
  const loose = element({ x: 25, y: 80, width: 10, height: 10 });
  expect(assignFrame([lockedFrame, loose], loose.id)[1].frameId).toBeNull();
  expect(assignFrame(elements, anchored.id)[2]).toBe(anchored);
});
it('duplicates complete frames unlocked, remaps internal attachments, and leaves original locks untouched', () => {
  const frame = element({ type: 'frame', locked: true, x: 0, y: 0, width: 500, height: 400 });
  const first = element({ frameId: frame.id, locked: true }), second = element({ frameId: frame.id, x: 180 });
  const line = element({ type: 'connector', fromId: first.id, toId: second.id, text: 'Leads to', locked: true });
  const result = duplicateSelected([frame, first, second, line], [frame.id, first.id]);
  const [copyFrame, copyFirst, copySecond, copyLine] = result.elements.slice(4);
  expect(result.selected).toEqual([copyFrame.id, copyFirst.id]);
  expect(copyFirst).toMatchObject({ x: 44, y: 74, frameId: copyFrame.id, locked: false });
  expect(copySecond.frameId).toBe(copyFrame.id);
  expect(copyLine).toMatchObject({ fromId: copyFirst.id, toId: copySecond.id, text: 'Leads to', locked: false });
  expect(documentError({ ...emptyDocument(), elements: result.elements })).toBeNull();
  expect(result.elements[0]).toBe(frame); expect(result.elements[1].locked).toBe(true);
  const detached = duplicateSelected([frame, first], [first.id]);
  expect(detached.elements[2]).toMatchObject({ locked: false, frameId: null });
  const copiedLine = duplicateSelected([first, second, line], [line.id]).elements[3];
  expect(copiedLine).toMatchObject({ fromId: first.id, toId: second.id });
});
it('removes attached connectors with endpoints, ungroups frame children, and preserves locked connector endpoints', () => {
  const frame = element({ type: 'frame' }), first = element({ frameId: frame.id }), second = element();
  const line = element({ type: 'connector', fromId: first.id, toId: second.id });
  expect(deleteSelected([frame, first, second, line], [first.id]).map(e => e.id)).toEqual([frame.id, second.id]);
  expect(deleteSelected([frame, first, second, line], [frame.id])[0]).toMatchObject({ id: first.id, frameId: null });
  const locked = { ...line, locked: true };
  expect(deleteSelected([first, second, locked], [first.id, second.id, line.id])).toEqual([first, second, locked]);
});
it('aligns movable selection roots using their bounds and moves grouped children only once', () => {
  const frame = element({ type: 'frame', x: 100, y: 0, width: 200, height: 300 }), child = element({ frameId: frame.id, x: 120 });
  const other = element({ x: 10 }), locked = element({ x: -100, locked: true });
  const result = alignElements([frame, child, other, locked], [frame.id, child.id, other.id, locked.id], 'left');
  expect(result.map(e => e.x)).toEqual([10, 30, 10, -100]);
  const centered = alignElements([element({ x: 0, width: 100, id: frame.id }), element({ x: 200, width: 200, id: other.id })], [frame.id, other.id], 'center');
  expect(centered.map(e => e.x + e.width / 2)).toEqual([200, 200]);
  const ungrouped = alignElements([frame, child, other], [child.id, other.id], 'left');
  expect(ungrouped[1]).toMatchObject({ x: 10, frameId: null });
  expect(moveElements(ungrouped, frame.id, 50, 0)[1].x).toBe(10);
  const entering = element({ x: 600 });
  const grouped = alignElements([frame, child, entering], [child.id, entering.id], 'left');
  expect(grouped[2]).toMatchObject({ x: child.x, frameId: frame.id });
});
it('attaches connector paths to borders, follows movement, and encloses curved parallel edges and self-loops', () => {
  const first = element({ x: 0, y: 0, width: 100, height: 100 }), second = element({ type: 'ellipse', x: 300, y: 0, width: 100, height: 100 });
  const line = element({ type: 'connector', fromId: first.id, toId: second.id });
  const straight = connectorGeometry(line, [first, second])!;
  expect(straight.start).toEqual({ x: 100, y: 50 }); expect(straight.end).toEqual({ x: 300, y: 50 }); expect(straight.label).toEqual({ x: 200, y: 50 });
  const moved = connectorGeometry(line, moveElements([first, second], second.id, 100, 0))!;
  expect(moved.end.x).toBe(400);
  const above = connectorGeometry({ ...line, bend: -80 }, [first, second])!, below = connectorGeometry({ ...line, bend: 80 }, [first, second])!;
  expect(above.label.y).toBeLessThan(50); expect(below.label.y).toBeGreaterThan(50);
  expect(((below.end.x - 350) / 50) ** 2 + ((below.end.y - 50) / 50) ** 2).toBeCloseTo(1);
  const loop = connectorGeometry({ ...line, toId: first.id }, [first])!;
  expect(loop.path).toContain(' C '); expect(loop.bounds.width).toBeGreaterThan(50); expect(loop.bounds.y).toBeLessThan(first.y);
  for (const point of [loop.start, loop.end, loop.label]) {
    expect(point.x).toBeGreaterThanOrEqual(loop.bounds.x); expect(point.x).toBeLessThanOrEqual(loop.bounds.x + loop.bounds.width);
    expect(point.y).toBeGreaterThanOrEqual(loop.bounds.y); expect(point.y).toBeLessThanOrEqual(loop.bounds.y + loop.bounds.height);
  }
  expect(connectorGeometry(line, [first])).toBeNull();
});
it('keeps edits made during a save, retries failed drafts, and allows saving after a clean flush', async () => {
  const id = crypto.randomUUID(), document = emptyDocument();
  const pending = Promise.withResolvers<Response>();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id, name: 'Clues', revision: 0, document })).mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(Response.json({ revision: 2, name: 'Clues' })).mockResolvedValueOnce(Response.json({ message: 'Conflict' }, { status: 409 })).mockResolvedValueOnce(Response.json({ revision: 3, name: 'Clues' }));
  vi.stubGlobal('fetch', fetcher);
  await loadBoard(id); await saveBoard(id);
  editBoard(id, { ...document, elements: [element({ text: 'First' })] }); const saving = saveBoard(id);
  editBoard(id, { ...document, elements: [element({ text: 'Latest' })] }); pending.resolve(Response.json({ revision: 1, name: 'Clues' }));
  expect(await saving).toBe(true); expect(get(boardDrafts)[id]).toMatchObject({ revision: 2, dirty: false });
  expect(JSON.parse(fetcher.mock.calls[2][1].body).document.elements[0].text).toBe('Latest');
  undoBoard(id); expect(await saveBoard(id)).toBe(false); expect(get(boardDrafts)[id]).toMatchObject({ dirty: true, error: 'Conflict' });
  await flushBoards(); expect(get(boardDrafts)[id]).toMatchObject({ revision: 3, dirty: false });
});

it('keeps a deleted board in the picker until its unsaved draft can be recovered', async () => {
  const id = crypto.randomUUID();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id, name: 'Draft', revision: 0, document: emptyDocument() })).mockResolvedValueOnce(Response.json({ message: 'Board not found' }, { status: 404 })).mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json({ message: 'Board not found' }, { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  await loadBoard(id); editBoard(id, { ...emptyDocument(), elements: [element({ text: 'Keep me' })] });
  await saveBoard(id); await loadBoards();
  expect(get(boardList)).toContainEqual({ id, name: 'Draft' });
  expect(get(boardDrafts)[id]).toMatchObject({ dirty: true, error: 'Board not found' });
  await deleteBoard(id); expect(get(boardDrafts)[id]).toBeUndefined(); expect(get(boardList)).toEqual([]);
  expect(get(failedWrites)).toEqual([]);
});

it('flushes an in-flight image into the board before allowing the workspace to leave', async () => {
  const id = crypto.randomUUID(), upload = Promise.withResolvers<Response>();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id, name: 'Images', revision: 0, document: emptyDocument() })).mockImplementationOnce(() => upload.promise).mockResolvedValueOnce(Response.json({ revision: 1, name: 'Images' }));
  vi.stubGlobal('fetch', fetcher); await loadBoard(id);
  const adding = uploadBoardImage(id, new File(['png'], 'image.png', { type: 'image/png' }), { x: 10, y: 20 });
  let left = false; const leaving = flushBoards().then(() => { left = true; });
  await Promise.resolve(); expect(left).toBe(false);
  upload.resolve(Response.json({ url: `/api/maps/file/${crypto.randomUUID()}_1790395600000.png`, width: 40, height: 20 }));
  await adding; await leaving;
  const saved = JSON.parse(fetcher.mock.calls[2][1].body); expect(saved.document.elements[0]).toMatchObject({ type: 'image', x: 10, y: 20, width: 320, height: 160 });
  expect(get(boardDrafts)[id].dirty).toBe(false);
});

it('keeps upload failures visible to workspace flushing after the board window closes', async () => {
  const id = crypto.randomUUID();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id, name: 'Images', revision: 0, document: emptyDocument() })).mockResolvedValueOnce(Response.json({ message: 'Upload failed. Choose the image again.' }, { status: 503 })));
  await loadBoard(id);
  await expect(uploadBoardImage(id, new File(['png'], 'image.png'), { x: 0, y: 0 })).rejects.toThrow('Upload failed');
  await expect(flushPendingWrites()).rejects.toThrow('Some changes failed');
  expect(get(failedWrites)[0].message).toContain('Choose the image again');
});
