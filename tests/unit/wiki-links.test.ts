import { describe, it, expect } from 'vitest';
import { parseWikiLinks, type WikiLinkEntity } from '$lib/wiki-links.js';

const POOL: WikiLinkEntity[] = [
	{ id: 'c1', name: 'Aragorn', type: 'Character' },
	{ id: 'c2', name: 'Boromir', type: 'Character' },
	{ id: 'l1', name: 'Edoras', type: 'Location' }
];

describe('parseWikiLinks', () => {
	it('returns [] for empty body', () => {
		expect(parseWikiLinks('', POOL)).toEqual([]);
	});

	it('returns single text segment when no links', () => {
		expect(parseWikiLinks('Hello world', POOL)).toEqual([
			{ kind: 'text', text: 'Hello world' }
		]);
	});

	it('resolves a single known link', () => {
		const segs = parseWikiLinks('Met [[Aragorn]] today.', POOL);
		expect(segs).toHaveLength(3);
		expect(segs[0]).toEqual({ kind: 'text', text: 'Met ' });
		expect(segs[1].kind).toBe('link');
		if (segs[1].kind !== 'link') throw new Error();
		expect(segs[1].name).toBe('Aragorn');
		expect(segs[1].entity).toEqual(POOL[0]);
		expect(segs[2]).toEqual({ kind: 'text', text: ' today.' });
	});

	it('resolves multiple links interleaved with text', () => {
		const segs = parseWikiLinks('[[Aragorn]] rode to [[Edoras]] alone.', POOL);
		expect(segs.map((s) => s.kind)).toEqual(['link', 'text', 'link', 'text']);
	});

	it('matches case-insensitively but preserves the as-written name', () => {
		const segs = parseWikiLinks('see [[aragorn]]', POOL);
		expect(segs).toHaveLength(2);
		if (segs[1].kind !== 'link') throw new Error();
		expect(segs[1].name).toBe('aragorn');
		expect(segs[1].entity?.id).toBe('c1');
	});

	it('returns entity:null for unknown names', () => {
		const segs = parseWikiLinks('hi [[Faramir]]', POOL);
		if (segs[1].kind !== 'link') throw new Error();
		expect(segs[1].entity).toBeNull();
		expect(segs[1].name).toBe('Faramir');
	});

	it('does not produce empty text segments between adjacent links', () => {
		const segs = parseWikiLinks('[[Aragorn]][[Boromir]]', POOL);
		expect(segs).toHaveLength(2);
		expect(segs.every((s) => s.kind === 'link')).toBe(true);
	});

	it('preserves newlines in text segments', () => {
		const segs = parseWikiLinks('line one\n[[Aragorn]]\nline two', POOL);
		expect(segs).toHaveLength(3);
		expect((segs[0] as { text: string }).text).toBe('line one\n');
		expect((segs[2] as { text: string }).text).toBe('\nline two');
	});

	it('rejects bracket sequences with embedded newlines as links', () => {
		const segs = parseWikiLinks('[[Aragorn\nstill writing]] continues', POOL);
		// Whole thing is text — the regex disallows \n inside the marker.
		expect(segs).toEqual([
			{ kind: 'text', text: '[[Aragorn\nstill writing]] continues' }
		]);
	});

	it('trims surrounding whitespace inside the marker', () => {
		const segs = parseWikiLinks('[[  Aragorn  ]]', POOL);
		if (segs[0].kind !== 'link') throw new Error();
		expect(segs[0].name).toBe('Aragorn');
		expect(segs[0].entity?.id).toBe('c1');
	});

	it('last duplicate name in the pool wins', () => {
		const pool: WikiLinkEntity[] = [
			{ id: 'a', name: 'Doppel', type: 'Character' },
			{ id: 'b', name: 'Doppel', type: 'Location' }
		];
		const segs = parseWikiLinks('see [[Doppel]]', pool);
		if (segs[1].kind !== 'link') throw new Error();
		expect(segs[1].entity?.id).toBe('b');
	});

	it('does not match unclosed markers', () => {
		expect(parseWikiLinks('[[Aragorn', POOL)).toEqual([
			{ kind: 'text', text: '[[Aragorn' }
		]);
	});
});
