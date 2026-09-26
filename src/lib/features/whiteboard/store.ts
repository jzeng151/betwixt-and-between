import { get, writable } from 'svelte/store';
import { storyFetch } from '$lib/story-fetch.js';
import { failedWrites, trackCreation, writeRetryKey } from '$lib/stores/pending-writes.js';
import { documentError, type Board, type BoardDocument } from './model.js';

type Snapshot = Pick<Board, 'name' | 'document'>;
type Draft = Board & { dirty: boolean; saving: boolean; error: string; undo: Snapshot[]; redo: Snapshot[] };
export const boardList = writable<Array<{ id: string; name: string }>>([]);
export const boardDrafts = writable<Record<string, Draft>>({});
export const activeBoardId = writable<string | null>(null);
const selectionKey = () => `betwixt-board:${new URL(window.location.href).searchParams.get('story') ?? 'default'}`;
activeBoardId.subscribe(id => {
  if (id && typeof window !== 'undefined') try { sessionStorage.setItem(selectionKey(), id); } catch { /* Storage may be disabled. */ }
});
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saves = new Map<string, Promise<boolean>>();
const key = (id: string) => `whiteboard:${id}`;
function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
function patch(id: string, values: Partial<Draft>) {
  boardDrafts.update(all => ({ ...all, [id]: { ...all[id], ...values } }));
  if (typeof window !== 'undefined') {
    if (Object.values(get(boardDrafts)).some(d => d.dirty)) window.addEventListener('beforeunload', warn);
    else window.removeEventListener('beforeunload', warn);
  }
}
async function responseData(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'Could not save the board. Try again.');
  return data;
}
export async function loadBoards() {
  const boards: Array<{ id: string; name: string }> = await responseData(await storyFetch('/api/whiteboards'));
  // Keep unsaved drafts reachable even if another tab deleted their saved board.
  for (const draft of Object.values(get(boardDrafts))) if (draft.dirty && !boards.some(b => b.id === draft.id)) boards.push({ id: draft.id, name: draft.name });
  boardList.set(boards);
  let selected = get(activeBoardId);
  if (!selected && typeof window !== 'undefined') try { selected = sessionStorage.getItem(selectionKey()); } catch { /* Storage may be disabled. */ }
  activeBoardId.set(boards.some(b => b.id === selected) ? selected : boards[0]?.id ?? null);
}
export async function loadBoard(id: string, discard = false) {
  if (get(boardDrafts)[id] && !discard) return;
  clearTimeout(timers.get(id));
  if (saves.has(id)) await saves.get(id);
  const board: Board = await responseData(await storyFetch(`/api/whiteboards/${id}`));
  patch(id, { ...board, dirty: false, saving: false, error: '', undo: [], redo: [] });
  if (discard) failedWrites.update(all => all.filter(f => f.retryKey !== key(id)));
}
export async function createBoard(name: string) {
  const board: Board = await trackCreation(writeRetryKey('whiteboard:create', { name }), async id => responseData(await storyFetch('/api/whiteboards', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name })
  }, { required: false })));
  boardList.update(all => [...all.filter(b => b.id !== board.id), { id: board.id, name: board.name }]);
  patch(board.id, { ...board, dirty: false, saving: false, error: '', undo: [], redo: [] });
  activeBoardId.set(board.id);
}
export function editBoard(id: string, document: BoardDocument, name?: string, history = true) {
  const current = get(boardDrafts)[id];
  if (!current) return;
  if (name !== undefined && (!name.trim() || name.trim().length > 100)) throw new Error('Use a name between 1 and 100 characters.');
  const invalid = documentError(document);
  if (invalid) throw new Error(invalid);
  // ponytail: 20 whole-document undo snapshots; use operation history for larger boards.
  patch(id, { document, name: name ?? current.name, dirty: true,
    ...(history ? { undo: [...current.undo, { name: current.name, document: current.document }].slice(-20), redo: [] } : {}) });
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { void saveBoard(id); }, 500));
}
export function undoBoard(id: string, redo = false) {
  const current = get(boardDrafts)[id];
  const from = redo ? current.redo : current.undo, to = redo ? current.undo : current.redo;
  const previous = from.at(-1);
  if (!previous) return;
  editBoard(id, previous.document, previous.name, false);
  patch(id, { [redo ? 'redo' : 'undo']: from.slice(0, -1), [redo ? 'undo' : 'redo']: [...to, { name: current.name, document: current.document }] });
}
export function saveBoard(id: string): Promise<boolean> {
  clearTimeout(timers.get(id));
  if (saves.has(id)) return saves.get(id)!;
  if (!get(boardDrafts)[id]?.dirty) return Promise.resolve(true);
  const task = (async () => {
    patch(id, { saving: true, error: '' });
    try {
      while (get(boardDrafts)[id]?.dirty) {
        const submitted = get(boardDrafts)[id];
        const saved: Board = await responseData(await storyFetch(`/api/whiteboards/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: submitted.name, revision: submitted.revision, document: submitted.document }) }, { retryKey: key(id) }));
        const current = get(boardDrafts)[id];
        patch(id, { revision: saved.revision, dirty: current.document !== submitted.document || current.name !== submitted.name });
        boardList.update(all => all.map(b => b.id === id ? { id, name: saved.name } : b));
      }
      return true;
    } catch (cause) { patch(id, { error: cause instanceof Error ? cause.message : 'Could not save. Your draft is kept in this session.' }); return false; }
    finally { patch(id, { saving: false }); saves.delete(id); }
  })();
  saves.set(id, task);
  return task;
}
export async function flushBoards() {
  const results = await Promise.all(Object.values(get(boardDrafts)).filter(b => b.dirty).map(b => saveBoard(b.id)));
  if (results.some(ok => !ok)) throw new Error('Save or download your whiteboard drafts before leaving.');
}
export async function deleteBoard(id: string) {
  clearTimeout(timers.get(id));
  if (saves.has(id)) await saves.get(id);
  await responseData(await storyFetch(`/api/whiteboards/${id}`, { method: 'DELETE' }, { retryKey: key(id) }));
  boardList.update(all => all.filter(b => b.id !== id));
  patch(id, { dirty: false });
  boardDrafts.update(all => { const next = { ...all }; delete next[id]; return next; });
  if (get(activeBoardId) === id) activeBoardId.set(null);
}
