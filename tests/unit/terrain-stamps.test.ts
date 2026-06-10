import { describe, it, expect } from 'vitest';
import {
	objectStamps,
	objectStampGroups,
	stampsForKey
} from '../../src/lib/features/map/terrain-tilesets.js';
import type { ObjectStamp, TerrainManifest } from '../../src/lib/features/map/terrain-tilesets.js';

// WM3 Slice C — varied-scatter resolution helpers. These are pure and
// branch-rich (family-key vs individual-key vs unknown), but were only
// exercised indirectly by the "renders without errors" stamp/scatter E2E.
// This pins the resolution SEMANTICS the renderer + palette depend on.

const stamp = (key: string, group: string, label: string): ObjectStamp => ({
	key,
	group,
	label,
	url: `/api/sprites/${key}.png`
});

const manifest = (objects?: ObjectStamp[]): TerrainManifest => ({
	tileSize: 32,
	categories: {},
	...(objects ? { objects } : {})
});

const TREE_1 = stamp('tree_object_01', 'tree_object', 'Tree');
const TREE_2 = stamp('tree_object_02', 'tree_object', 'Tree');
const ROCK_1 = stamp('rock_object_01', 'rock_object', 'Rock');

describe('objectStamps', () => {
	it('returns [] for a null manifest', () => {
		expect(objectStamps(null)).toEqual([]);
	});

	it('returns [] when the manifest has no objects key', () => {
		expect(objectStamps(manifest())).toEqual([]);
	});

	it('returns the objects array when present', () => {
		const m = manifest([TREE_1, ROCK_1]);
		expect(objectStamps(m)).toEqual([TREE_1, ROCK_1]);
	});
});

describe('objectStampGroups', () => {
	it('returns [] for a null manifest', () => {
		expect(objectStampGroups(null)).toEqual([]);
	});

	it('folds multiple members into one group and carries the label', () => {
		const groups = objectStampGroups(manifest([TREE_1, TREE_2]));
		expect(groups).toEqual([{ group: 'tree_object', label: 'Tree', stamps: [TREE_1, TREE_2] }]);
	});

	it('produces one entry per distinct family group', () => {
		const groups = objectStampGroups(manifest([TREE_1, ROCK_1, TREE_2]));
		expect(groups).toHaveLength(2);
		const tree = groups.find((g) => g.group === 'tree_object');
		const rock = groups.find((g) => g.group === 'rock_object');
		expect(tree?.stamps).toEqual([TREE_1, TREE_2]);
		expect(rock?.stamps).toEqual([ROCK_1]);
	});
});

describe('stampsForKey', () => {
	it('returns [] for a null manifest', () => {
		expect(stampsForKey(null, 'tree_object')).toEqual([]);
	});

	it('a family key yields every member of that group', () => {
		expect(stampsForKey(manifest([TREE_1, TREE_2, ROCK_1]), 'tree_object')).toEqual([
			TREE_1,
			TREE_2
		]);
	});

	it('an individual key yields just that sprite', () => {
		expect(stampsForKey(manifest([TREE_1, TREE_2, ROCK_1]), 'tree_object_02')).toEqual([TREE_2]);
	});

	it('an unknown key yields [] (lazy GC of removed stamps)', () => {
		expect(stampsForKey(manifest([TREE_1]), 'ghost_object_99')).toEqual([]);
	});
});
