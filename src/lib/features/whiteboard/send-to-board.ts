import { get, writable } from 'svelte/store';
import { entities } from '$lib/stores/entities.js';
import { notesStore } from '$lib/stores/notes.js';
import type { BoardElement } from './model.js';
import type { GraphCapture } from './graph-import.js';

export type BoardImport =
  | { kind: 'reference'; target: NonNullable<BoardElement['target']>; name: string }
  | { kind: 'diagram' | 'snapshot'; graph: GraphCapture; name: string; caption: string };
export const boardImport = writable<BoardImport | null>(null);
let importVersion = 0;
// Direct graph imports and closing the dialog also supersede an in-flight note send.
boardImport.subscribe(() => { importVersion++; });

export async function sendReferenceToBoard(target: NonNullable<BoardElement['target']>, name: string) {
  const version = ++importVersion;
  if (target.kind === 'entity') {
    if (!await notesStore.flushDrafts(target.id)) return;
    name = get(entities).find(entity => entity.id === target.id)?.name ?? name;
  }
  if (version !== importVersion) return;
  boardImport.set({ kind: 'reference', target, name });
}
