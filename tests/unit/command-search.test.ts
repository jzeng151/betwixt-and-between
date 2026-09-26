import { describe, expect, it } from 'vitest';
import { findCommands } from '$lib/os/command-search.js';
import type { Entity } from '$lib/stores/entities.js';

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
});
