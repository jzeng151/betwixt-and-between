import { describe, expect, it } from 'vitest';
import { findCommands } from '$lib/os/command-search.js';
import type { Entity } from '$lib/stores/entities.js';
import type { WhiteboardCommand } from '$lib/features/whiteboard/commands.js';

const entities = [
  { id: 'one', name: 'The Elara Archives', type: 'Location', data: { body_md: 'secret phrase' } },
  { id: 'two', name: 'Elara', type: 'Character', data: {} },
  { id: 'three', name: 'Elara Voss', type: 'Character', data: {} }
] as Entity[];

describe('command search', () => {
  it('ranks exact names before prefixes and other matches, and combines type/name words', () => {
    expect(findCommands(entities, ' ELARA ').map((r) => r.id)).toEqual(['two', 'three', 'one']);
    expect(findCommands(entities, 'character voss').map((r) => r.id)).toEqual(['three']);
    expect(findCommands(entities, 'secret phrase')).toEqual([]);
  });
  it('keeps app and notebook destinations distinct from similarly named entities', () => {
    const results = findCommands([{ ...entities[0], name: 'Notes' }], 'notes', [
      { id: 'notebook', name: 'Notes', body: '', folderId: null, position: null }
    ]);
    expect(results.map((r) => r.id)).toEqual(['app-notes', 'one', 'note-notebook']);
    expect(results[2].note?.id).toBe('notebook');
    expect(findCommands([], 'story player')[0].appId).toBe('story-player');
    expect(findCommands([{ ...entities[0], type: 'Note', name: 'Deleted note' }], 'deleted')).toEqual([]);
  });
  it('searches available whiteboard actions by name and context without replacing global destinations', () => {
    const commands: WhiteboardCommand[] = [
      { id: 'fit', name: 'Fit board', run: () => {} },
      { id: 'fit-selection', name: 'Fit board to selection', run: () => {} },
      { id: 'delete', name: 'Delete element', disabled: true, run: () => {} }
    ];
    expect(findCommands(entities, 'fit board', [], commands).map((r) => r.id)).toEqual(['whiteboard-fit', 'whiteboard-fit-selection']);
    expect(findCommands(entities, 'whiteboard fit', [], commands).map((r) => r.whiteboardCommandId)).toEqual(['fit', 'fit-selection']);
    expect(findCommands(entities, 'delete', [], commands)).toEqual([]);
    expect(findCommands(entities, 'elara', [], commands).map((r) => r.id)).toEqual(['two', 'three', 'one']);
    expect(findCommands([], 'whiteboard', [], commands).map((r) => r.id)).toEqual(['app-whiteboard', 'whiteboard-fit', 'whiteboard-fit-selection']);
    expect(findCommands([], '', [], commands).some((r) => r.id === 'whiteboard-delete')).toBe(false);
    expect(findCommands([], 'fit board')).toEqual([]);
  });
});
