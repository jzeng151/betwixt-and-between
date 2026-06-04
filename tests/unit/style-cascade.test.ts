// Slice 3 D5 — style cascade unit tests. Updated for Settings customization
// Phase 2, Item 1: resolveStyle now takes the resolved palette (resolvedTypeHex)
// as the type-default color layer, plus a character cycle index, and the
// contrast guard primitives ship alongside.

import { describe, it, expect } from 'vitest';
import {
	resolveStyle,
	GLOBAL_STYLE_DEFAULT,
	STYLE_DEFAULTS,
	needsContrastRing,
	relativeLuminance,
	contrastRatio,
	MAP_CANVAS_BG,
	CONTRAST_RING_COLOR
} from '../../src/lib/features/map/style-cascade.js';
import { ENTITY_TYPE_HEX } from '../../src/lib/entity-type-colors.js';
import { CHARACTER_COLORS } from '../../src/lib/features/timeline/timeline-helpers.js';
import type { Entity } from '../../src/lib/stores/entities.js';

// The palette passed at render. Use the real base so the tests double as a
// guard that the type-default layer is the app palette, not the old hardcoded
// map hex.
const HEX = ENTITY_TYPE_HEX;

function mk(overrides: Partial<Entity> & { type: Entity['type'] }): Entity {
	return {
		id: overrides.id ?? 'id',
		type: overrides.type,
		name: overrides.name ?? 'X',
		data: overrides.data ?? {},
		parentId: null,
		position: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z'
	};
}

describe('resolveStyle cascade (palette type-default)', () => {
	it('falls back to the resolved palette hex for a type with no override', () => {
		const style = resolveStyle(mk({ type: 'Note' }), HEX);
		expect(style.color).toBe(HEX.Note);
		expect(style.scale).toBe(GLOBAL_STYLE_DEFAULT.scale);
		expect(style.opacity).toBe(GLOBAL_STYLE_DEFAULT.opacity);
		expect(style.icon).toBeNull();
	});

	it('uses the palette for Character when there is no data.color / index', () => {
		expect(resolveStyle(mk({ type: 'Character' }), HEX).color).toBe(HEX.Character);
	});

	it('a per-user palette override reaches the sprite (recolor acceptance)', () => {
		const custom = { ...HEX, Character: '#112233' };
		expect(resolveStyle(mk({ type: 'Character' }), custom).color).toBe('#112233');
	});

	it('STYLE_DEFAULTS keeps only scale tuning (color keys deleted, F3a)', () => {
		expect(STYLE_DEFAULTS.Artifact?.color).toBeUndefined();
		expect(STYLE_DEFAULTS.Item?.color).toBeUndefined();
		expect(resolveStyle(mk({ type: 'Artifact' }), HEX).scale).toBe(0.9);
		expect(resolveStyle(mk({ type: 'Item' }), HEX).scale).toBe(0.8);
		// And the color for those types is the palette, not a hardcoded map hex.
		expect(resolveStyle(mk({ type: 'Artifact' }), HEX).color).toBe(HEX.Artifact);
	});
});

describe('resolveStyle character + data.color layers (graph/map parity)', () => {
	it('an uncustomized Character cycles CHARACTER_COLORS by index (matches the graph)', () => {
		expect(resolveStyle(mk({ type: 'Character' }), HEX, undefined, 0).color).toBe(CHARACTER_COLORS[0]);
		expect(resolveStyle(mk({ type: 'Character' }), HEX, undefined, 3).color).toBe(CHARACTER_COLORS[3]);
		expect(
			resolveStyle(mk({ type: 'Character' }), HEX, undefined, CHARACTER_COLORS.length).color
		).toBe(CHARACTER_COLORS[0]);
	});

	it('data.color wins over the character cycle', () => {
		const style = resolveStyle(mk({ type: 'Character', data: { color: '#abcdef' } }), HEX, undefined, 2);
		expect(style.color).toBe('#abcdef');
	});

	it('data.style.color wins over data.color (P3 precedence)', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { color: '#aaaaaa', style: { color: '#bbbbbb' } } }),
			HEX,
			undefined,
			1
		);
		expect(style.color).toBe('#bbbbbb');
	});

	it('placement override wins over everything', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { color: '#aaaaaa', style: { color: '#bbbbbb' } } }),
			HEX,
			{ color: '#cccccc' },
			1
		);
		expect(style.color).toBe('#cccccc');
	});

	it('full precedence: placement > data.style.color > data.color > cycle > palette', () => {
		const base = mk({ type: 'Character' });
		expect(resolveStyle(base, HEX, undefined, undefined).color).toBe(HEX.Character); // palette
		expect(resolveStyle(base, HEX, undefined, 4).color).toBe(CHARACTER_COLORS[4]); // cycle
		expect(resolveStyle(mk({ type: 'Character', data: { color: '#010203' } }), HEX, undefined, 4).color).toBe('#010203');
	});
});

describe('resolveStyle non-color layers (unchanged)', () => {
	it('clamps scale to [0.1, 10]', () => {
		expect(resolveStyle(mk({ type: 'Character', data: { style: { scale: 0.01 } } }), HEX).scale).toBe(0.1);
		expect(resolveStyle(mk({ type: 'Character', data: { style: { scale: 100 } } }), HEX).scale).toBe(10);
	});

	it('clamps opacity to [0, 1]', () => {
		expect(resolveStyle(mk({ type: 'Character', data: { style: { opacity: -0.5 } } }), HEX).opacity).toBe(0);
		expect(resolveStyle(mk({ type: 'Character', data: { style: { opacity: 2 } } }), HEX).opacity).toBe(1);
	});

	it('accepts explicit null icon', () => {
		expect(resolveStyle(mk({ type: 'Character', data: { style: { icon: null } } }), HEX).icon).toBeNull();
	});

	it('placement scale/opacity merge per field', () => {
		const style = resolveStyle(
			mk({ type: 'Artifact', data: { style: { opacity: 0.5 } } }),
			HEX,
			{ scale: 3, opacity: 0.9 }
		);
		expect(style.scale).toBe(3);
		expect(style.opacity).toBe(0.9);
		expect(style.color).toBe(HEX.Artifact);
	});

	it('absent placementStyle leaves the entity-level cascade unchanged', () => {
		const entity = mk({ type: 'Character', data: { style: { color: '#abcdef' } } });
		expect(resolveStyle(entity, HEX, undefined)).toEqual(resolveStyle(entity, HEX));
	});
});

describe('explicit-neutral survives (codex-P2, IRON-RULE regression #1)', () => {
	it('preserves an explicit neutral (#9ca3af) at the entity level', () => {
		const style = resolveStyle(mk({ type: 'Character', data: { style: { color: '#9ca3af' } } }), HEX);
		expect(style.color).toBe('#9ca3af');
	});
	it('preserves an explicit neutral (#9ca3af) at the placement level', () => {
		expect(resolveStyle(mk({ type: 'Character' }), HEX, { color: '#9ca3af' }).color).toBe('#9ca3af');
	});
	it('contrast guard does NOT touch the resolved color (it only adds a ring)', () => {
		// A dark explicit neutral is preserved as the fill even when it needs a ring.
		const style = resolveStyle(mk({ type: 'Character', data: { style: { color: '#0e1116' } } }), HEX);
		expect(style.color).toBe('#0e1116');
		expect(needsContrastRing(style.color)).toBe(true);
	});
});

describe('contrast guard primitives (Item 1 / D4)', () => {
	it('relativeLuminance: white ≈ 1, black ≈ 0', () => {
		expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2);
		expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
	});
	it('unknown input → 1 (treated bright, no ring)', () => {
		expect(relativeLuminance('not-a-hex')).toBe(1);
		expect(needsContrastRing('not-a-hex')).toBe(false);
	});

	// codex P1: the guard must accept every hex shape the renderer draws and the
	// server accepts (3/4/6/8-digit), or a dark short-hex (e.g. #000 via the
	// StyleEditor) renders with no ring.
	it('normalizes 3/4/8-digit hex like the renderer (no guard bypass)', () => {
		expect(relativeLuminance('#000')).toBeCloseTo(0, 2); // 3-digit black
		expect(needsContrastRing('#000')).toBe(true);
		expect(needsContrastRing('#000f')).toBe(true); // 4-digit + alpha
		expect(needsContrastRing('#0d0f14ff')).toBe(true); // 8-digit canvas + alpha
		expect(needsContrastRing('#fff')).toBe(false); // 3-digit white
	});
	it('a dark fill against the canvas needs a ring; a light fill does not', () => {
		expect(needsContrastRing('#101317')).toBe(true);
		expect(needsContrastRing('#e8e0d0')).toBe(false);
		expect(needsContrastRing(MAP_CANVAS_BG)).toBe(true);
	});
	it('the fixed ring color reads against the canvas (≥3:1)', () => {
		expect(contrastRatio(CONTRAST_RING_COLOR, MAP_CANVAS_BG)).toBeGreaterThanOrEqual(3);
	});

	// Threshold invariant: no DEFAULT palette color should trip the guard (the
	// base palette was chosen to read on the dark canvas), and the canvas color
	// itself must. Locks the threshold against future ENTITY_TYPE_HEX edits.
	it('no default palette type needs a contrast ring; the canvas color does', () => {
		for (const [type, hex] of Object.entries(ENTITY_TYPE_HEX)) {
			expect(needsContrastRing(hex), `${type} (${hex}) should not need a ring`).toBe(false);
		}
		expect(needsContrastRing(MAP_CANVAS_BG)).toBe(true);
	});
});
