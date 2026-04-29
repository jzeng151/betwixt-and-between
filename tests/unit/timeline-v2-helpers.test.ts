import { describe, it, expect } from 'vitest';
import {
	widthClassForBar,
	presenceLabel,
	internalActBoundaryFractions,
	colorFor,
	dataNoteSnippet,
	parseEntityData,
	positionToStartFKs,
	positionToEndFKs,
	CHARACTER_COLORS,
	EVENT_COLOR
} from '../../src/lib/timeline-v2-helpers.js';

describe('widthClassForBar', () => {
	it('returns "tiny" for widths below 40px', () => {
		expect(widthClassForBar(0)).toBe('tiny');
		expect(widthClassForBar(20)).toBe('tiny');
		expect(widthClassForBar(39.999)).toBe('tiny');
	});
	it('returns "narrow" for widths in [40, 100)', () => {
		expect(widthClassForBar(40)).toBe('narrow');
		expect(widthClassForBar(60)).toBe('narrow');
		expect(widthClassForBar(99.999)).toBe('narrow');
	});
	it('returns "normal" for widths >= 100px', () => {
		expect(widthClassForBar(100)).toBe('normal');
		expect(widthClassForBar(150)).toBe('normal');
		expect(widthClassForBar(800)).toBe('normal');
	});
	it('handles edge cases (negative, NaN-like)', () => {
		// negative width: treat as tiny (defensive)
		expect(widthClassForBar(-10)).toBe('tiny');
	});
});

describe('presenceLabel', () => {
	// Single-act, no scene context
	it('full Act 1 → "Act 1"', () => {
		expect(presenceLabel(1.0, 2.0)).toBe('Act 1');
	});

	it('first 25% of Act 1 → "first 25% of Act 1"', () => {
		expect(presenceLabel(1.0, 1.25)).toBe('first 25% of Act 1');
	});

	it('last 50% of Act 1 → "last 50% of Act 1"', () => {
		expect(presenceLabel(1.5, 2.0)).toBe('last 50% of Act 1');
	});

	it('mid-fraction of Act 0 → "25–75% of Act 0"', () => {
		expect(presenceLabel(0.25, 0.75)).toBe('25–75% of Act 0');
	});

	// Scene-anchored single-act
	it('full Act 1 with scenes context still says "Act 1"', () => {
		expect(presenceLabel(1.0, 2.0, { sceneCounts: { 1: 5 } })).toBe('Act 1');
	});

	it('one scene of Act 1 (scene 0 of 5) → "Act 1, scene 0"', () => {
		expect(presenceLabel(1.0, 1.2, { sceneCounts: { 1: 5 } })).toBe('Act 1, scene 0');
	});

	it('scenes 1–3 of Act 1 (5 scenes) → "Act 1, scenes 1–3 of 5"', () => {
		expect(presenceLabel(1.2, 1.8, { sceneCounts: { 1: 5 } })).toBe('Act 1, scenes 1–3 of 5');
	});

	// Multi-act
	it('Act 0 → end of Act 2 → "start of Act 0 → end of Act 2"', () => {
		expect(presenceLabel(0, 3)).toBe('start of Act 0 → end of Act 2');
	});

	it('middle of Act 0 through end of Act 2 → "50% into Act 0 → end of Act 2"', () => {
		expect(presenceLabel(0.5, 3.0)).toBe('50% into Act 0 → end of Act 2');
	});

	it('mid Act 1 → mid Act 2 → "50% into Act 1 → 75% into Act 2"', () => {
		expect(presenceLabel(1.5, 2.75)).toBe('50% into Act 1 → 75% into Act 2');
	});
});

describe('internalActBoundaryFractions', () => {
	it('single-act bar has no internal boundaries', () => {
		expect(internalActBoundaryFractions(1.0, 2.0)).toEqual([]);
		expect(internalActBoundaryFractions(1.2, 1.8)).toEqual([]);
		expect(internalActBoundaryFractions(0.25, 0.75)).toEqual([]);
	});

	it('two-act span produces one boundary at the right fraction', () => {
		// span [0.5, 2.0): boundary at 1.0 → fraction = (1.0 - 0.5) / 1.5 = 0.333...
		const fractions = internalActBoundaryFractions(0.5, 2.0);
		expect(fractions).toHaveLength(1);
		expect(fractions[0]).toBeCloseTo(1 / 3, 9);
	});

	it('three-act span produces two boundaries', () => {
		// span [0.0, 3.0): boundaries at 1.0 and 2.0
		const fractions = internalActBoundaryFractions(0.0, 3.0);
		expect(fractions).toHaveLength(2);
		expect(fractions[0]).toBeCloseTo(1 / 3, 9);
		expect(fractions[1]).toBeCloseTo(2 / 3, 9);
	});

	it('off-boundary span: 0.5 → 2.5 produces one boundary at 1.0 and one at 2.0', () => {
		const fractions = internalActBoundaryFractions(0.5, 2.5);
		expect(fractions).toHaveLength(2);
		expect(fractions[0]).toBeCloseTo(0.25, 9); // (1.0 - 0.5) / 2.0
		expect(fractions[1]).toBeCloseTo(0.75, 9); // (2.0 - 0.5) / 2.0
	});

	it('end exactly on whole-act boundary is NOT itself a boundary marker', () => {
		// span [1.0, 2.0): endActIdx = floor(2.0 - epsilon) = 1, so no internal boundaries.
		expect(internalActBoundaryFractions(1.0, 2.0)).toEqual([]);
	});
});

describe('parseEntityData', () => {
	it('returns {} for null/undefined/empty', () => {
		expect(parseEntityData(null)).toEqual({});
		expect(parseEntityData(undefined)).toEqual({});
		expect(parseEntityData('')).toEqual({});
	});
	it('returns {} for invalid JSON', () => {
		expect(parseEntityData('{not json')).toEqual({});
	});
	it('returns {} for non-object JSON (array, string, number, null)', () => {
		expect(parseEntityData('[1,2]')).toEqual({});
		expect(parseEntityData('"foo"')).toEqual({});
		expect(parseEntityData('42')).toEqual({});
		expect(parseEntityData('null')).toEqual({});
	});
	it('parses plain objects', () => {
		expect(parseEntityData('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
	});
});

describe('colorFor', () => {
	it('returns EVENT_COLOR for Event entities (custom color ignored)', () => {
		expect(colorFor({ type: 'Event', data: '{}' }, 0)).toBe(EVENT_COLOR);
		expect(colorFor({ type: 'Event', data: '{"color":"#ff0000"}' }, 0)).toBe(EVENT_COLOR);
	});
	it('returns custom hex color for Character with valid data.color', () => {
		expect(colorFor({ type: 'Character', data: '{"color":"#abcdef"}' }, 5)).toBe('#abcdef');
	});
	it('falls back to CHARACTER_COLORS cycle when data.color is unset', () => {
		expect(colorFor({ type: 'Character', data: '{}' }, 0)).toBe(CHARACTER_COLORS[0]);
		expect(colorFor({ type: 'Character', data: '{}' }, 3)).toBe(CHARACTER_COLORS[3]);
	});
	it('cycles by index modulo CHARACTER_COLORS.length', () => {
		expect(colorFor({ type: 'Character', data: '{}' }, 8)).toBe(CHARACTER_COLORS[0]);
		expect(colorFor({ type: 'Character', data: '{}' }, 17)).toBe(CHARACTER_COLORS[1]);
	});
	it('falls back to cycle when data.color is invalid', () => {
		expect(colorFor({ type: 'Character', data: '{"color":"red"}' }, 0)).toBe(CHARACTER_COLORS[0]);
		expect(colorFor({ type: 'Character', data: '{"color":"#ggg"}' }, 0)).toBe(CHARACTER_COLORS[0]);
	});
	it('falls back to cycle when data is malformed JSON', () => {
		expect(colorFor({ type: 'Character', data: 'garbage' }, 2)).toBe(CHARACTER_COLORS[2]);
	});
});

describe('dataNoteSnippet', () => {
	it('returns null when entity.data is empty/missing', () => {
		expect(dataNoteSnippet({ type: 'Character', data: '' })).toBe(null);
		expect(dataNoteSnippet({ type: 'Character', data: '{}' })).toBe(null);
	});
	it('default (unset timelineLabel) returns first line of notes', () => {
		expect(
			dataNoteSnippet({ type: 'Character', data: JSON.stringify({ notes: 'Loyal soldier' }) })
		).toBe('Loyal soldier');
	});
	it('default trims and skips empty leading lines', () => {
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({ notes: '\n\n  First real line  \nsecond' })
			})
		).toBe('First real line');
	});
	it('default truncates lines > 30 chars with ellipsis', () => {
		const long = 'a'.repeat(40);
		const r = dataNoteSnippet({ type: 'Character', data: JSON.stringify({ notes: long }) });
		expect(r).toBe('a'.repeat(30) + '…');
	});
	it('mode=name-only returns null even when notes exist', () => {
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({ notes: 'Hello', timelineLabel: { mode: 'name-only' } })
			})
		).toBe(null);
	});
	it('mode=name-and-note matches default behavior', () => {
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({ notes: 'Hi there', timelineLabel: { mode: 'name-and-note' } })
			})
		).toBe('Hi there');
	});
	it('mode=custom reads from the named field', () => {
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({
					motivation: 'Avenge father',
					timelineLabel: { mode: 'custom', field: 'motivation' }
				})
			})
		).toBe('Avenge father');
	});
	it('mode=custom returns null when field is missing or empty', () => {
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({ timelineLabel: { mode: 'custom', field: 'nope' } })
			})
		).toBe(null);
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({ timelineLabel: { mode: 'custom', field: '' } })
			})
		).toBe(null);
	});
	it('mode=custom truncates field value > 30 chars', () => {
		const long = 'b'.repeat(50);
		expect(
			dataNoteSnippet({
				type: 'Character',
				data: JSON.stringify({ arc: long, timelineLabel: { mode: 'custom', field: 'arc' } })
			})
		).toBe('b'.repeat(30) + '…');
	});
	it('handles malformed JSON gracefully', () => {
		expect(dataNoteSnippet({ type: 'Character', data: '{bad' })).toBe(null);
	});
});

describe('positionToStartFKs', () => {
	const acts = [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }];

	it('returns null when out of range', () => {
		expect(positionToStartFKs(-0.1, acts, new Map())).toBeNull();
		expect(positionToStartFKs(3, acts, new Map())).toBeNull();
	});
	it('snaps to act start when fraction is ~0', () => {
		expect(positionToStartFKs(1.0, acts, new Map())).toEqual({
			startActId: 'a1',
			startSceneId: null
		});
	});
	it('returns scene FK when fraction matches a scene boundary', () => {
		const scenes = new Map([['a1', [{ id: 's0' }, { id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]]]);
		// 1 + 2/5 = 1.4 → scene index 2
		expect(positionToStartFKs(1.4, acts, scenes)).toEqual({
			startActId: 'a1',
			startSceneId: 's2'
		});
	});
	it('returns sceneId=null with free-fraction when no scenes', () => {
		// Was previously null (rejected); now allowed — position carries precision.
		expect(positionToStartFKs(1.37, acts, new Map())).toEqual({
			startActId: 'a1',
			startSceneId: null
		});
	});
	it('returns sceneId=null with free-fraction when off-grid in scened act', () => {
		const scenes = new Map([['a1', [{ id: 's0' }, { id: 's1' }]]]); // m=2, boundaries at 0, 0.5
		// 1.37 is between scene boundaries → free-fraction
		expect(positionToStartFKs(1.37, acts, scenes)).toEqual({
			startActId: 'a1',
			startSceneId: null
		});
	});
});

describe('positionToEndFKs', () => {
	const acts = [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }];

	it('returns end-of-story when position == acts.length', () => {
		expect(positionToEndFKs(3.0, acts, new Map())).toEqual({
			endActId: 'a2',
			endSceneId: null
		});
	});
	it('snaps to act end when fraction is ~1', () => {
		expect(positionToEndFKs(2.0, acts, new Map())).toEqual({
			endActId: 'a1',
			endSceneId: null
		});
	});
	it('returns scene FK when fraction matches a scene boundary', () => {
		const scenes = new Map([['a1', [{ id: 's0' }, { id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]]]);
		// 1 + 3/5 = 1.6 → end of scene 2 (k=3, scenes[k-1]=scenes[2])
		expect(positionToEndFKs(1.6, acts, scenes)).toEqual({
			endActId: 'a1',
			endSceneId: 's2'
		});
	});
	it('returns sceneId=null with free-fraction when no scenes', () => {
		expect(positionToEndFKs(1.73, acts, new Map())).toEqual({
			endActId: 'a1',
			endSceneId: null
		});
	});
});
