import { get, writable } from 'svelte/store';
import { entities, entityLoadStatus } from '$lib/stores/entities.js';
import { noteEntries, notesStore } from '$lib/stores/notes.js';
import type { BoardElement } from './model.js';
import type { GraphCapture } from './graph-import.js';

export type BoardImport =
  | { kind: 'reference'; target: NonNullable<BoardElement['target']>; name: string }
  | { kind: 'diagram' | 'snapshot'; graph: GraphCapture; name: string; caption: string };
export const boardImport = writable<BoardImport | null>(null);

export async function sendReferenceToBoard(target: NonNullable<BoardElement['target']>, name: string) {
  if (target.kind === 'entity') {
    const hadDraft = notesStore.drafts.has(target.id);
    if (!await notesStore.flushDrafts(target.id)) return;
    // Notes may hold an older title after editing elsewhere; prefer the refreshed entity cache.
    name = (hadDraft && get(entityLoadStatus) === 'error'
      ? get(noteEntries).find(entry => entry.id === target.id)?.name
      : get(entities).find(entity => entity.id === target.id)?.name) ?? name;
  }
  boardImport.set({ kind: 'reference', target, name });
}
