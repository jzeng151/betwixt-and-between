// Slice 3 D5 — style cascade unit tests.

import { describe, it, expect } from 'vitest';
import {
	resolveStyle,
	GLOBAL_STYLE_DEFAULT,
	STYLE_DEFAULTS
} from '../../src/lib/features/map/style-cascade.js';
import type { Entity } from '../../src/lib/stores/entities.js';

function mk(overrides: Partial<Entity> & { type: Entity['type'] }): Entity {
	return {
		id: 'id',
		type: overrides.type,
		name: overrides.name ?? 'X',
		data: overrides.data ?? {},
		parentId: null,
		position: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z'
	};
}

describe('resolveStyle cascade', () => {
	it('returns GLOBAL_STYLE_DEFAULT for an unknown type with no overrides', () => {
		const style = resolveStyle(mk({ type: 'Note' }));
		expect(style).toEqual(GLOBAL_STYLE_DEFAULT);
	});

	it('TYPE_DEFAULTS overrides GLOBAL for Character', () => {
		const style = resolveStyle(mk({ type: 'Character' }));
		// Character has color + scale; opacity/icon fall through to GLOBAL.
		expect(style.color).toBe(STYLE_DEFAULTS.Character!.color);
		expect(style.scale).toBe(STYLE_DEFAULTS.Character!.scale);
		expect(style.opacity).toBe(GLOBAL_STYLE_DEFAULT.opacity);
		expect(style.icon).toBe(GLOBAL_STYLE_DEFAULT.icon);
	});

	it('entity.data.style overrides TYPE_DEFAULTS', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { style: { color: '#ff0000' } } })
		);
		expect(style.color).toBe('#ff0000');
		// Scale still inherits from TYPE_DEFAULTS.
		expect(style.scale).toBe(STYLE_DEFAULTS.Character!.scale);
	});

	it('partial entity.data.style override merges with type defaults', () => {
		const style = resolveStyle(
			mk({
				type: 'Artifact',
				data: { style: { opacity: 0.5, icon: 'https://example.com/icon.png' } }
			})
		);
		expect(style.color).toBe(STYLE_DEFAULTS.Artifact!.color);
		expect(style.scale).toBe(STYLE_DEFAULTS.Artifact!.scale);
		expect(style.opacity).toBe(0.5);
		expect(style.icon).toBe('https://example.com/icon.png');
	});

	it('clamps scale to [0.1, 10]', () => {
		const tooSmall = resolveStyle(
			mk({ type: 'Character', data: { style: { scale: 0.01 } } })
		);
		expect(tooSmall.scale).toBe(0.1);
		const tooBig = resolveStyle(
			mk({ type: 'Character', data: { style: { scale: 100 } } })
		);
		expect(tooBig.scale).toBe(10);
	});

	it('clamps opacity to [0, 1]', () => {
		const negative = resolveStyle(
			mk({ type: 'Character', data: { style: { opacity: -0.5 } } })
		);
		expect(negative.opacity).toBe(0);
		const tooBig = resolveStyle(
			mk({ type: 'Character', data: { style: { opacity: 2 } } })
		);
		expect(tooBig.opacity).toBe(1);
	});

	it('silently drops unknown keys in entity.data.style', () => {
		const style = resolveStyle(
			mk({
				type: 'Character',
				// extraField is not part of ResolvedStyle; cascade ignores it.
				data: { style: { color: '#ff0000', extraField: 'ignored' } as Record<string, unknown> }
			})
		);
		expect(style.color).toBe('#ff0000');
		expect(style).not.toHaveProperty('extraField');
	});

	it('rejects non-string color override (falls through to type default)', () => {
		const style = resolveStyle(
			mk({
				type: 'Character',
				data: { style: { color: 12345 as unknown as string } }
			})
		);
		// Non-string falls through; STYLE_DEFAULTS.Character.color used.
		expect(style.color).toBe(STYLE_DEFAULTS.Character!.color);
	});

	it('accepts explicit null icon (vs undefined — distinct intent)', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { style: { icon: null } } })
		);
		expect(style.icon).toBeNull();
	});

	it('handles entity with no data field at all', () => {
		const style = resolveStyle(mk({ type: 'Artifact', data: {} }));
		expect(style.color).toBe(STYLE_DEFAULTS.Artifact!.color);
	});

	it('handles entity.data.style === null', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { style: null as unknown as undefined } })
		);
		// null style → no overrides; type defaults stand.
		expect(style.color).toBe(STYLE_DEFAULTS.Character!.color);
	});

	// PR #58 codex P2 — per-placement style override is the top cascade layer.
	it('placement.data.style overrides entity.data.style', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { style: { color: '#ff0000', scale: 2 } } }),
			{ color: '#00ff00' }
		);
		// Placement color wins; scale (not set on placement) keeps entity override.
		expect(style.color).toBe('#00ff00');
		expect(style.scale).toBe(2);
	});

	it('placement override merges per-field, falling through to entity/type/global', () => {
		const style = resolveStyle(
			mk({ type: 'Artifact', data: { style: { opacity: 0.5 } } }),
			{ scale: 3, opacity: 0.9 }
		);
		expect(style.scale).toBe(3); // placement
		expect(style.opacity).toBe(0.9); // placement beats entity's 0.5
		expect(style.color).toBe(STYLE_DEFAULTS.Artifact!.color); // neither set → type default
	});

	// codex P2 (PR #59): the marker renderer now trusts resolved.color directly
	// (no GLOBAL_DEFAULT_COLOR sentinel branch), so the cascade must preserve an
	// explicit neutral (#9ca3af) override rather than letting it read as "unset"
	// and render the entity's type color. Pins both the entity- and placement-
	// level neutral override.
	it('preserves an explicit neutral (#9ca3af) at the entity level', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { style: { color: '#9ca3af' } } })
		);
		expect(style.color).toBe('#9ca3af'); // NOT the Character type blue
	});

	it('preserves an explicit neutral (#9ca3af) at the placement level', () => {
		const style = resolveStyle(mk({ type: 'Character' }), { color: '#9ca3af' });
		expect(style.color).toBe('#9ca3af');
	});

	it('absent placementStyle leaves the entity-level cascade unchanged', () => {
		const entity = mk({ type: 'Character', data: { style: { color: '#abcdef' } } });
		expect(resolveStyle(entity, undefined)).toEqual(resolveStyle(entity));
	});

	it('malformed placementStyle is ignored (unknown keys dropped)', () => {
		const style = resolveStyle(
			mk({ type: 'Character', data: { style: { color: '#111111' } } }),
			{ color: 42, bogus: 'x' } as unknown
		);
		// Non-string placement color falls through to the entity override.
		expect(style.color).toBe('#111111');
	});
});
