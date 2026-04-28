import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writable, get } from 'svelte/store';
import type { Entity } from '../../src/lib/stores/entities.js';

// Replace the entities store with a plain writable store we can seed directly.
// navigation.ts only calls `get(entities).find(...)`, so a writable<Entity[]>
// satisfies the contract.
vi.mock('../../src/lib/stores/entities.js', () => {
	const store = writable<Entity[]>([]);
	return { entities: store };
});

import { entities } from '../../src/lib/stores/entities.js';
import { windowStore } from '../../src/lib/stores/windows.js';
import { openEntity } from '../../src/lib/navigation.js';

// The mocked `entities` is a plain writable store; cast for `.set`.
const entitiesWritable = entities as unknown as ReturnType<typeof writable<Entity[]>>;

function makeEntity(id: string, type: Entity['type'], name: string): Entity {
	return {
		id,
		type,
		name,
		data: '{}',
		parentId: null,
		position: null,
		createdAt: 0,
		updatedAt: 0
	};
}

function clearWindows() {
	// Close every open window. windowStore exposes close(id) but no reset.
	const all = get(windowStore);
	for (const w of all) windowStore.close(w.id);
}

describe('openEntity', () => {
	beforeEach(() => {
		clearWindows();
		entitiesWritable.set([]);
	});

	it('routes Character → character-editor window', () => {
		entitiesWritable.set([makeEntity('e1', 'Character', 'Elara')]);
		openEntity('e1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('character-editor');
		expect(wins[0].id).toBe('character-editor-e1');
	});

	it('routes Location → world-map window', () => {
		entitiesWritable.set([makeEntity('loc1', 'Location', 'Castle')]);
		openEntity('loc1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('world-map');
		expect(wins[0].id).toBe('world-map-loc1');
	});

	it('routes Event → timeline window', () => {
		entitiesWritable.set([makeEntity('ev1', 'Event', 'Battle')]);
		openEntity('ev1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('timeline');
		expect(wins[0].id).toBe('timeline-ev1');
	});

	it('routes Act → timeline window', () => {
		entitiesWritable.set([makeEntity('act1', 'Act', 'Act One')]);
		openEntity('act1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('timeline');
		expect(wins[0].id).toBe('timeline-act1');
	});

	it('routes Scene → timeline window', () => {
		entitiesWritable.set([makeEntity('sc1', 'Scene', 'Opening')]);
		openEntity('sc1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('timeline');
		expect(wins[0].id).toBe('timeline-sc1');
	});

	it('routes Note → wiki window', () => {
		entitiesWritable.set([makeEntity('n1', 'Note', 'Lore')]);
		openEntity('n1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('wiki');
		expect(wins[0].id).toBe('wiki-n1');
	});

	it('opens a window with the correct entityId field', () => {
		entitiesWritable.set([makeEntity('e1', 'Character', 'Elara')]);
		openEntity('e1');
		const wins = get(windowStore);
		expect(wins[0].entityId).toBe('e1');
	});

	it('calling openEntity twice on the same id does not duplicate the window', () => {
		entitiesWritable.set([makeEntity('e1', 'Character', 'Elara')]);
		openEntity('e1');
		openEntity('e1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].id).toBe('character-editor-e1');
	});

	it('second openEntity call focuses the existing window (raises zIndex)', () => {
		entitiesWritable.set([
			makeEntity('e1', 'Character', 'Elara'),
			makeEntity('e2', 'Character', 'Damien')
		]);
		openEntity('e1');
		openEntity('e2'); // e2 now has highest zIndex
		const zE1Before = get(windowStore).find((w) => w.id === 'character-editor-e1')!.zIndex;
		const zE2Before = get(windowStore).find((w) => w.id === 'character-editor-e2')!.zIndex;
		expect(zE2Before).toBeGreaterThan(zE1Before);

		openEntity('e1'); // should focus, not duplicate
		const wins = get(windowStore);
		expect(wins).toHaveLength(2);
		const zE1After = wins.find((w) => w.id === 'character-editor-e1')!.zIndex;
		const zE2After = wins.find((w) => w.id === 'character-editor-e2')!.zIndex;
		expect(zE1After).toBeGreaterThan(zE2After);
	});

	it('two different Characters get two coexisting windows', () => {
		entitiesWritable.set([
			makeEntity('elara', 'Character', 'Elara'),
			makeEntity('damien', 'Character', 'Damien')
		]);
		openEntity('elara');
		openEntity('damien');
		const wins = get(windowStore);
		expect(wins).toHaveLength(2);
		const ids = wins.map((w) => w.id).sort();
		expect(ids).toEqual(['character-editor-damien', 'character-editor-elara']);
	});

	it('openEntity on a non-existent id is a no-op (no crash, no window)', () => {
		entitiesWritable.set([makeEntity('e1', 'Character', 'Elara')]);
		expect(() => openEntity('does-not-exist')).not.toThrow();
		expect(get(windowStore)).toHaveLength(0);
	});

	it('openEntity on empty entities store is a no-op', () => {
		entitiesWritable.set([]);
		expect(() => openEntity('anything')).not.toThrow();
		expect(get(windowStore)).toHaveLength(0);
	});

	it('mixed-type opens produce one window per entity with correct appId', () => {
		entitiesWritable.set([
			makeEntity('c1', 'Character', 'Elara'),
			makeEntity('l1', 'Location', 'Castle'),
			makeEntity('n1', 'Note', 'Lore')
		]);
		openEntity('c1');
		openEntity('l1');
		openEntity('n1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(3);
		const byId = Object.fromEntries(wins.map((w) => [w.id, w.appId]));
		expect(byId['character-editor-c1']).toBe('character-editor');
		expect(byId['world-map-l1']).toBe('world-map');
		expect(byId['wiki-n1']).toBe('wiki');
	});
});
