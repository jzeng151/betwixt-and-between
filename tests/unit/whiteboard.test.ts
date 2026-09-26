import { expect, it, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { documentError, emptyDocument, assignFrame, moveElements, type BoardElement } from '$lib/features/whiteboard/model.js';
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
