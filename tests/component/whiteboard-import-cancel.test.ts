import { expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import SendToWhiteboard from '$lib/features/whiteboard/SendToWhiteboard.svelte';
import { boardImport } from '$lib/features/whiteboard/send-to-board.js';
import { boardDrafts, boardList, activeBoardId } from '$lib/features/whiteboard/store.js';
import { failedWrites } from '$lib/stores/pending-writes.js';
import { emptyDocument } from '$lib/features/whiteboard/model.js';

vi.mock('$lib/features/whiteboard/graph-import.js', () => ({
  graphSnapshot: async () => new File(['png'], 'Graph.png', { type: 'image/png' }), graphDiagram: vi.fn()
}));
vi.mock('$lib/os/windows-store.js', () => ({ windowStore: { open: vi.fn() } }));
afterEach(() => { cleanup(); boardImport.set(null); boardDrafts.set({}); boardList.set([]); activeBoardId.set(null); failedWrites.set([]); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('canceling a failed snapshot drops its upload failure and preserves unrelated unsaved work', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  const id = crypto.randomUUID();
  failedWrites.set([{ message: 'Keep this entity failure', retryKey: 'entity:other' }]);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/upload-image')
    ? Response.json({ message: 'Image upload failed' }, { status: 503 })
    : url.endsWith('/api/whiteboards') ? Response.json([{ id, name: 'Clues' }])
      : Response.json({ id, name: 'Clues', revision: 0, document: emptyDocument() })));
  const view = render(SendToWhiteboard);
  boardImport.set({ kind: 'snapshot', name: 'Graph', caption: 'Story time: 0', graph: { background: '#161920', nodes: [], edges: [] } });
  await waitFor(() => expect(view.getByRole('button', { name: 'Add to board' })).toBeEnabled());
  await fireEvent.click(view.getByRole('button', { name: 'Add to board' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Image upload failed'));
  expect(get(failedWrites)).toHaveLength(2);
  await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(get(failedWrites)).toEqual([{ message: 'Keep this entity failure', retryKey: 'entity:other' }]);
  expect(get(boardDrafts)[id].document.elements).toEqual([]);
});

it.each(['cancel', 'rename'])('clears only its own failed board creation on %s', async action => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  failedWrites.set([{ message: 'Keep another failure', retryKey: 'entity:other' }]);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return Response.json([]);
    const body = JSON.parse(init.body as string);
    return body.name === 'First name' ? Response.json({ message: 'Creation interrupted' }, { status: 503 })
      : Response.json({ id: body.id, name: body.name, revision: 0, document: emptyDocument() });
  }));
  const view = render(SendToWhiteboard);
  boardImport.set({ kind: 'reference', name: 'Mara', target: { kind: 'entity', id: crypto.randomUUID() } });
  const name = await view.findByRole('textbox', { name: 'New board name' });
  await fireEvent.input(name, { target: { value: 'First name' } });
  await fireEvent.click(view.getByRole('button', { name: 'Add to board' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Creation interrupted'));
  expect(get(failedWrites)).toHaveLength(2);
  if (action === 'cancel') await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  else {
    await fireEvent.input(name, { target: { value: 'Second name' } });
    await fireEvent.click(view.getByRole('button', { name: 'Add to board' }));
  }
  await waitFor(() => expect(get(boardImport)).toBeNull());
  expect(get(failedWrites)).toEqual([{ message: 'Keep another failure', retryKey: 'entity:other' }]);
});
