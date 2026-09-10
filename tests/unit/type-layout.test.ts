import { describe, it, expect } from 'vitest';
import { layoutByType } from '../../src/lib/features/graph/type-layout.js';

describe('layoutByType (Phase 1B C5)', () => {
	it('returns empty array when every node is pinned', () => {
		const result = layoutByType({
			nodes: [
				{ id: 'a', type: 'Character', width: 120, height: 32 },
				{ id: 'b', type: 'Character', width: 120, height: 32 }
			],
			pinnedIds: new Set(['a', 'b']),
			currentPositions: [
				{ id: 'a', x: 0, y: 0 },
				{ id: 'b', x: 100, y: 100 }
			],
			typeOrder: ['Character']
		});
		expect(result).toEqual([]);
	});

	it('returns positions only for unpinned nodes', () => {
		const result = layoutByType({
			nodes: [
				{ id: 'a', type: 'Character', width: 120, height: 32 },
				{ id: 'b', type: 'Character', width: 120, height: 32 },
				{ id: 'c', type: 'Character', width: 120, height: 32 }
			],
			pinnedIds: new Set(['a']),
			currentPositions: [
				{ id: 'a', x: 0, y: 0 },
				{ id: 'b', x: 100, y: 100 },
				{ id: 'c', x: 200, y: 200 }
			],
			typeOrder: ['Character']
		});
		const ids = result.map((r) => r.id).sort();
		expect(ids).toEqual(['b', 'c']);
		expect(result.find((r) => r.id === 'a')).toBeUndefined();
	});

	it('shifts unpinned centroid to align with pinned centroid', () => {
		// Pinned at (1000, 1000); unpinned should end up centered near (1000, 1000)
		// regardless of the raw layout origin.
		const result = layoutByType({
			nodes: [
				{ id: 'p', type: 'Character', width: 120, height: 32 },
				{ id: 'u1', type: 'Character', width: 120, height: 32 },
				{ id: 'u2', type: 'Character', width: 120, height: 32 }
			],
			pinnedIds: new Set(['p']),
			currentPositions: [{ id: 'p', x: 1000, y: 1000 }],
			typeOrder: ['Character']
		});
		expect(result).toHaveLength(2);
		const cx = (result[0].x + result[1].x) / 2;
		const cy = (result[0].y + result[1].y) / 2;
		// Should be near (1000, 1000) — the pinned centroid.
		expect(Math.abs(cx - 1000)).toBeLessThan(50);
		expect(Math.abs(cy - 1000)).toBeLessThan(50);
	});

	it('shifts to viewportCenter when pinnedSet is empty', () => {
		const result = layoutByType({
			nodes: [
				{ id: 'a', type: 'Character', width: 120, height: 32 },
				{ id: 'b', type: 'Character', width: 120, height: 32 }
			],
			pinnedIds: new Set(),
			currentPositions: [],
			typeOrder: ['Character'],
			viewportCenter: { x: 500, y: 300 }
		});
		expect(result).toHaveLength(2);
		const cx = (result[0].x + result[1].x) / 2;
		const cy = (result[0].y + result[1].y) / 2;
		expect(Math.abs(cx - 500)).toBeLessThan(50);
		expect(Math.abs(cy - 300)).toBeLessThan(50);
	});

	it('respects typeOrder rank assignment (Scene above Character)', () => {
		// rankdir is TB (top → bottom). Index 0 in typeOrder lays out at top
		// (smaller y), index N-1 at bottom. Scene at index 0 should have
		// smaller y than Character at index 1.
		const result = layoutByType({
			nodes: [
				{ id: 's', type: 'Scene', width: 120, height: 32 },
				{ id: 'c', type: 'Character', width: 120, height: 32 }
			],
			pinnedIds: new Set(),
			currentPositions: [],
			typeOrder: ['Scene', 'Character']
		});
		const scene = result.find((r) => r.id === 's')!;
		const character = result.find((r) => r.id === 'c')!;
		expect(scene.y).toBeLessThan(character.y);
	});

	it('orders multiple type bands', () => {
		// Disconnected nodes: edge-driven ranking (the previous broken
		// behavior) had nothing to bite on at all. Type-order must drive.
		const result = layoutByType({
			nodes: [
				{ id: 's', type: 'Scene', width: 120, height: 32 },
				{ id: 'c', type: 'Character', width: 120, height: 32 },
				{ id: 'a', type: 'Act', width: 120, height: 32 }
			],
			pinnedIds: new Set(),
			currentPositions: [],
			typeOrder: ['Scene', 'Character', 'Act']
		});
		const scene = result.find((r) => r.id === 's')!;
		const character = result.find((r) => r.id === 'c')!;
		const act = result.find((r) => r.id === 'a')!;
		expect(scene.y).toBeLessThan(character.y);
		expect(character.y).toBeLessThan(act.y);
	});

	it('places types missing from typeOrder at the bottom', () => {
		// 'Note' is not in typeOrder → should rank below Character.
		const result = layoutByType({
			nodes: [
				{ id: 'c', type: 'Character', width: 120, height: 32 },
				{ id: 'n', type: 'Note', width: 120, height: 32 }
			],
			pinnedIds: new Set(),
			currentPositions: [],
			typeOrder: ['Character'] // Note missing
		});
		const c = result.find((r) => r.id === 'c')!;
		const n = result.find((r) => r.id === 'n')!;
		expect(c.y).toBeLessThan(n.y);
	});
});
