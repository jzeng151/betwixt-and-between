import { writable } from 'svelte/store';
import type { BoardElement } from './model.js';
import type { GraphCapture } from './graph-import.js';

export type BoardImport =
  | { kind: 'reference'; target: NonNullable<BoardElement['target']>; name: string }
  | { kind: 'diagram' | 'snapshot'; graph: GraphCapture; name: string; caption: string };
export const boardImport = writable<BoardImport | null>(null);

export function sendReferenceToBoard(target: NonNullable<BoardElement['target']>, name: string) {
  boardImport.set({ kind: 'reference', target, name });
}
