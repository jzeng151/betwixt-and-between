/**
 * diffFromBase — the delta primitive behind first-login reconcile (T4, codex).
 * Only a user's actual deviations from defaults are pushed up to a freshly
 * created server row, so untouched keys keep tracking future default changes.
 */

import { describe, it, expect } from 'vitest';
import { diffFromBase } from '../../src/lib/preferences-merge.js';

describe('diffFromBase', () => {
	it('returns only the leaves that differ from base', () => {
		const base = { a: 1, b: { c: 2, d: 3 }, e: 4 };
		const over = { a: 1, b: { c: 99, d: 3 }, e: 4 };
		expect(diffFromBase(base, over)).toEqual({ b: { c: 99 } });
	});

	it('omits subtrees with no differing leaves', () => {
		const base = { appearance: { theme: 'dark', accentColor: '#c8942a' }, editor: { x: true } };
		const over = { appearance: { theme: 'dark', accentColor: '#abc123' }, editor: { x: true } };
		expect(diffFromBase(base, over)).toEqual({ appearance: { accentColor: '#abc123' } });
	});

	it('returns {} when over equals base (nothing to migrate)', () => {
		const base = { a: 1, b: { c: 2 } };
		expect(diffFromBase(base, { a: 1, b: { c: 2 } })).toEqual({});
	});

	it('includes keys present in over but absent from base', () => {
		expect(diffFromBase({ a: 1 }, { a: 1, b: 2 })).toEqual({ b: 2 });
		expect(diffFromBase({}, { nested: { x: 1 } })).toEqual({ nested: { x: 1 } });
	});

	it('compares arrays and primitives by value, replacing wholesale', () => {
		expect(diffFromBase({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual({ list: [1, 2, 3] });
		expect(diffFromBase({ list: [1, 2] }, { list: [1, 2] })).toEqual({});
	});

	it('skips prototype-pollution keys', () => {
		const over = JSON.parse('{"a":1,"__proto__":{"polluted":true}}');
		expect(diffFromBase({ a: 0 }, over)).toEqual({ a: 1 });
	});

	it('returns {} for a non-object over', () => {
		expect(diffFromBase({ a: 1 }, null)).toEqual({});
		expect(diffFromBase({ a: 1 }, 42)).toEqual({});
	});
});
