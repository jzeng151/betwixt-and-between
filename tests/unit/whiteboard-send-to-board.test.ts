import { beforeEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import { boardImport, sendReferenceToBoard } from '$lib/features/whiteboard/send-to-board.js';

const flushDrafts = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/notes.js', () => ({ notesStore: { flushDrafts } }));
vi.mock('$lib/stores/entities.js', async () => {
  const { writable } = await import('svelte/store');
  return { entities: writable([]) };
});

beforeEach(() => { boardImport.set(null); flushDrafts.mockReset(); });

test.each(['open', 'closed'])('a slow note send cannot replace a newer entity when its dialog is %s', async (dialog) => {
  let finish!: (saved: boolean) => void;
  flushDrafts.mockReturnValueOnce(new Promise<boolean>(resolve => { finish = resolve; })).mockResolvedValueOnce(true);
  const pending = sendReferenceToBoard({ kind: 'entity', id: 'note' }, 'Old note');
  await sendReferenceToBoard({ kind: 'entity', id: 'character' }, 'New character');
  expect(get(boardImport)).toMatchObject({ target: { id: 'character' } });
  if (dialog === 'closed') boardImport.set(null);
  finish(true);
  await pending;
  if (dialog === 'closed') expect(get(boardImport)).toBeNull();
  else expect(get(boardImport)).toMatchObject({ target: { id: 'character' } });
});

test('a direct graph import supersedes a pending note send', async () => {
  let finish!: (saved: boolean) => void;
  flushDrafts.mockReturnValueOnce(new Promise<boolean>(resolve => { finish = resolve; }));
  const pending = sendReferenceToBoard({ kind: 'entity', id: 'note' }, 'Old note');
  const graph = { kind: 'reference', target: { kind: 'graph', id: 'graph' }, name: 'Current graph' } as const;
  boardImport.set(graph);
  finish(true);
  await pending;
  expect(get(boardImport)).toEqual(graph);
});
