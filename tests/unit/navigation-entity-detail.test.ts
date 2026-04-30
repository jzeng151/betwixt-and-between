import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writable, get } from 'svelte/store';
import type { Entity } from '../../src/lib/stores/entities.js';

// Mock the entities store the same way navigation.test.ts does — navigation.ts
// only reads via `get(entities).find(...)`.
vi.mock('../../src/lib/stores/entities.js', () => {
	const store = writable<Entity[]>([]);
	return { entities: store };
});

import { entities } from '../../src/lib/stores/entities.js';
import { windowStore } from '../../src/lib/stores/windows.js';
// openEntityDetail is the new helper added in D10/9A. Import will fail at
// runtime until the implementation lands — these tests are expected RED.
import { openEntityDetail, openEntity } from '../../src/lib/navigation.js';

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
	const all = get(windowStore);
	for (const w of all) windowStore.close(w.id);
}

describe('openEntityDetail (D10 / 9A)', () => {
	beforeEach(() => {
		clearWindows();
		entitiesWritable.set([]);
	});

	it('opens an entity-detail window for the given entityId', () => {
		entitiesWritable.set([makeEntity('act-1', 'Act', 'Act One')]);
		const id = openEntityDetail('act-1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('entity-detail');
		expect(wins[0].entityId).toBe('act-1');
		expect(wins[0].id).toBe('entity-detail-act-1');
		expect(id).toBe('entity-detail-act-1');
	});

	it('returns the existing window id and focuses it on a second call', () => {
		entitiesWritable.set([
			makeEntity('act-1', 'Act', 'Act One'),
			makeEntity('act-2', 'Act', 'Act Two')
		]);
		openEntityDetail('act-1');
		openEntityDetail('act-2'); // act-2 now has highest zIndex
		const zBefore = get(windowStore).find((w) => w.id === 'entity-detail-act-1')!.zIndex;
		const zOtherBefore = get(windowStore).find((w) => w.id === 'entity-detail-act-2')!.zIndex;
		expect(zOtherBefore).toBeGreaterThan(zBefore);

		const idAgain = openEntityDetail('act-1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(2);
		expect(idAgain).toBe('entity-detail-act-1');
		const zAfter = wins.find((w) => w.id === 'entity-detail-act-1')!.zIndex;
		const zOtherAfter = wins.find((w) => w.id === 'entity-detail-act-2')!.zIndex;
		expect(zAfter).toBeGreaterThan(zOtherAfter);
	});

	it('does not throw when the entity does not exist in the store', () => {
		entitiesWritable.set([]);
		expect(() => openEntityDetail('does-not-exist')).not.toThrow();
		// Still opens an entity-detail window for that id; EntityDetail handles
		// the missing case internally (D10 contract: "Doesn't break for non-existent
		// entityId — just opens an empty editor").
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].id).toBe('entity-detail-does-not-exist');
	});

	it('opens distinct windows for distinct entityIds', () => {
		entitiesWritable.set([
			makeEntity('act-1', 'Act', 'A'),
			makeEntity('ev-1', 'Event', 'E'),
			makeEntity('sc-1', 'Scene', 'S')
		]);
		openEntityDetail('act-1');
		openEntityDetail('ev-1');
		openEntityDetail('sc-1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(3);
		const ids = wins.map((w) => w.id).sort();
		expect(ids).toEqual([
			'entity-detail-act-1',
			'entity-detail-ev-1',
			'entity-detail-sc-1'
		]);
		expect(wins.every((w) => w.appId === 'entity-detail')).toBe(true);
	});
});

describe('openEntity (post D10-extension / 19A)', () => {
	beforeEach(() => {
		clearWindows();
		entitiesWritable.set([]);
	});

	it('Act → entity-detail (migrated from timeline)', () => {
		entitiesWritable.set([makeEntity('act-1', 'Act', 'Act One')]);
		openEntity('act-1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('entity-detail');
		expect(wins[0].id).toBe('entity-detail-act-1');
	});

	it('Event → entity-detail (migrated from timeline)', () => {
		entitiesWritable.set([makeEntity('ev-1', 'Event', 'Battle')]);
		openEntity('ev-1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('entity-detail');
		expect(wins[0].id).toBe('entity-detail-ev-1');
	});

	it('Scene → entity-detail (collapses original T8 TODO)', () => {
		entitiesWritable.set([makeEntity('sc-1', 'Scene', 'Opening')]);
		openEntity('sc-1');
		const wins = get(windowStore);
		expect(wins).toHaveLength(1);
		expect(wins[0].appId).toBe('entity-detail');
	});

	it('Character/Location/Note unchanged (still legacy app routing)', () => {
		entitiesWritable.set([
			makeEntity('c1', 'Character', 'Ellie'),
			makeEntity('l1', 'Location', 'Castle'),
			makeEntity('n1', 'Note', 'Lore')
		]);
		openEntity('c1');
		openEntity('l1');
		openEntity('n1');
		const byId = Object.fromEntries(get(windowStore).map((w) => [w.entityId, w.appId]));
		expect(byId['c1']).toBe('character-editor');
		expect(byId['l1']).toBe('world-map');
		expect(byId['n1']).toBe('wiki');
	});
});
