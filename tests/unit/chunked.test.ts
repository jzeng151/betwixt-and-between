/**
 * 2026-06 review — `chunked` bounds the bind-parameter count of the moved-scene
 * FK rewrites in the Act-delete `moveScenesTo` path (an `inArray` over every
 * moved scene id would otherwise blow Postgres' 65535-parameter limit on a huge
 * Act). It also backs the bulk recompute UPDATEs. The splitting is the whole
 * mechanism, so pin its boundaries.
 */

import { describe, it, expect } from 'vitest';
import { chunked, BULK_UPDATE_CHUNK } from '../../src/lib/server/intervals.js';

describe('chunked', () => {
	it('returns no chunks for an empty array', () => {
		expect(chunked([], 1000)).toEqual([]);
	});

	it('keeps an array shorter than the chunk size in a single chunk', () => {
		expect(chunked([1, 2, 3], 1000)).toEqual([[1, 2, 3]]);
	});

	it('splits an exact multiple into equal full chunks', () => {
		expect(chunked([1, 2, 3, 4], 2)).toEqual([
			[1, 2],
			[3, 4]
		]);
	});

	it('puts the remainder in a final short chunk', () => {
		expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	it('keeps every chunk within the bind-parameter cap at the configured size', () => {
		const ids = Array.from({ length: BULK_UPDATE_CHUNK * 2 + 7 }, (_, i) => i);
		const slices = chunked(ids, BULK_UPDATE_CHUNK);
		expect(slices).toHaveLength(3);
		expect(slices.every((s) => s.length <= BULK_UPDATE_CHUNK)).toBe(true);
		expect(BULK_UPDATE_CHUNK).toBeLessThan(65535);
		// No id dropped or duplicated across the split.
		expect(slices.flat()).toEqual(ids);
	});
});
