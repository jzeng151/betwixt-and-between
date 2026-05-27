// Slice 3 T24 — server-side style whitelist unit tests.
//
// validateStyleOverride throws SvelteKit HttpError on rejection. Tests
// catch the error and assert .status === 400.

import { describe, it, expect } from 'vitest';
import {
	validateStyleOverride,
	validateStyleInData
} from '../../src/lib/server/style-validation.js';

function expectReject(fn: () => void): void {
	try {
		fn();
	} catch (err) {
		expect((err as { status?: number }).status).toBe(400);
		return;
	}
	throw new Error('expected validator to throw');
}

/** Wrap a "should not throw" call so we get an explicit expect() call.
 *  Vitest's expect-assertion guard fails tests with zero assertions. */
function expectAccept(fn: () => void): void {
	expect(fn).not.toThrow();
}

describe('validateStyleOverride', () => {
	it('accepts a fully-specified valid style', () => {
		expectAccept(() =>
			validateStyleOverride(
				{ color: '#aabbcc', icon: 'https://example.com/foo.png', scale: 2, opacity: 0.5 },
				'test'
			)
		);
	});

	it('accepts undefined (absent style)', () => {
		expectAccept(() => validateStyleOverride(undefined, 'test'));
		expectAccept(() => validateStyleOverride(null, 'test'));
	});

	it('rejects non-object', () => {
		expectReject(() => validateStyleOverride('not an object', 'test'));
		expectReject(() => validateStyleOverride([1, 2, 3], 'test'));
		expectReject(() => validateStyleOverride(42, 'test'));
	});

	it('rejects unknown keys', () => {
		expectReject(() => validateStyleOverride({ color: '#aabbcc', extra: 'no' }, 'test'));
	});

	it('rejects bad color formats', () => {
		expectReject(() => validateStyleOverride({ color: 'red' }, 'test'));
		expectReject(() => validateStyleOverride({ color: '#abcde' }, 'test')); // 5-digit
		expectReject(() => validateStyleOverride({ color: '#1234567' }, 'test')); // 7-digit
		expectReject(() => validateStyleOverride({ color: 'rgb(255, 0, 0)' }, 'test'));
	});

	it('accepts valid hex color variants (3/4/6/8 digits)', () => {
		expectAccept(() => validateStyleOverride({ color: '#abc' }, 'test'));
		expectAccept(() => validateStyleOverride({ color: '#abcd' }, 'test'));
		expectAccept(() => validateStyleOverride({ color: '#aabbcc' }, 'test'));
		expectAccept(() => validateStyleOverride({ color: '#aabbccdd' }, 'test'));
	});

	it('rejects out-of-range scale', () => {
		expectReject(() => validateStyleOverride({ scale: 0.05 }, 'test'));
		expectReject(() => validateStyleOverride({ scale: 11 }, 'test'));
		expectReject(() => validateStyleOverride({ scale: -1 }, 'test'));
	});

	it('rejects out-of-range opacity', () => {
		expectReject(() => validateStyleOverride({ opacity: -0.1 }, 'test'));
		expectReject(() => validateStyleOverride({ opacity: 1.1 }, 'test'));
	});

	it('accepts opacity boundary values 0 and 1', () => {
		expectAccept(() => validateStyleOverride({ opacity: 0 }, 'test'));
		expectAccept(() => validateStyleOverride({ opacity: 1 }, 'test'));
	});

	it('rejects non-string non-null icon', () => {
		expectReject(() => validateStyleOverride({ icon: 42 as unknown as string }, 'test'));
	});

	it('accepts icon as null or string', () => {
		expectAccept(() => validateStyleOverride({ icon: null }, 'test'));
		expectAccept(() => validateStyleOverride({ icon: 'https://example.com/a.png' }, 'test'));
	});

	it('rejects style jsonb larger than 4 KB', () => {
		// 5KB of "x" in a comment field would fail — but we only have whitelisted
		// keys. The cap catches "color: <huge string>". Build a 5KB color.
		const giant = '#' + 'a'.repeat(5000);
		expectReject(() => validateStyleOverride({ color: giant }, 'test'));
	});
});

describe('validateStyleInData', () => {
	it('passes when data has no style key', () => {
		expectAccept(() => validateStyleInData({ other: 'field' }, 'entity.data'));
	});

	it('passes when data is undefined / null / non-object', () => {
		expectAccept(() => validateStyleInData(undefined, 'entity.data'));
		expectAccept(() => validateStyleInData(null, 'entity.data'));
		expectAccept(() => validateStyleInData('not an object', 'entity.data'));
	});

	it('validates the nested style key when present', () => {
		expectAccept(() =>
			validateStyleInData({ style: { color: '#aabbcc' } }, 'entity.data')
		);
		expectReject(() =>
			validateStyleInData({ style: { color: 'invalid' } }, 'entity.data')
		);
	});
});
