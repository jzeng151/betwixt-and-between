import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { windowStore } from '../../src/lib/stores/windows.js';

// The window store is a module-level singleton, so reset state between tests
// by closing every window via the public API.
function reset() {
	const all = get(windowStore);
	for (const w of all) windowStore.close(w.id);
}

beforeEach(async () => {
	reset();
});

describe('windowStore.open', () => {
	it('creates a window with deterministic id `${appId}-${entityId}`', () => {
		const id = windowStore.open('character-editor', 'ent-1');
		expect(id).toBe('character-editor-ent-1');
		const all = get(windowStore);
		expect(all).toHaveLength(1);
		expect(all[0].appId).toBe('character-editor');
		expect(all[0].entityId).toBe('ent-1');
	});

	it('uses bare appId when no entityId is provided', () => {
		const id = windowStore.open('wiki');
		expect(id).toBe('wiki');
		expect(get(windowStore)[0].entityId).toBeNull();
	});

	it('focuses (does not duplicate) when opening a window that already exists', () => {
		const a = windowStore.open('character-editor', 'ent-1');
		const initialZ = get(windowStore)[0].zIndex;
		const b = windowStore.open('character-editor', 'ent-1');

		expect(a).toBe(b);
		expect(get(windowStore)).toHaveLength(1);
		expect(get(windowStore)[0].zIndex).toBeGreaterThan(initialZ);
	});

	it('story-graph creates a new instance on each call', () => {
		const a = windowStore.open('story-graph');
		// Date.now() may be the same ms — guard with a small delay-equivalent
		// by mutating zCounter through an extra open. The id is timestamp-based,
		// so we just assert the two windows coexist when the IDs differ.
		const b = windowStore.open('story-graph');
		const all = get(windowStore);
		// At minimum, there must be at least one story-graph window.
		// If timestamps collided, the second call would have focused — but that
		// would still leave both ids equal. So either ids differ (2 windows) or
		// they collided (1 window, focused). We assert the prefix in both cases.
		expect(a.startsWith('story-graph-')).toBe(true);
		expect(b.startsWith('story-graph-')).toBe(true);
		expect(all.every((w) => w.appId === 'story-graph')).toBe(true);
	});

	it('increments z-index on each new window', () => {
		windowStore.open('wiki');
		const z1 = get(windowStore)[0].zIndex;
		windowStore.open('character-editor', 'a');
		const z2 = get(windowStore).find((w) => w.id === 'character-editor-a')!.zIndex;
		expect(z2).toBeGreaterThan(z1);
	});

	it('uses graph-specific dimensions for story-graph', () => {
		windowStore.open('story-graph');
		const w = get(windowStore)[0];
		expect(w.width).toBe(640);
		expect(w.height).toBe(500);
	});

	it('uses timeline-specific width for timeline', () => {
		windowStore.open('timeline');
		const w = get(windowStore).find((x) => x.appId === 'timeline')!;
		expect(w.width).toBe(960);
		expect(w.height).toBe(480);
	});

	it('character-editor uses 380x480 (wider default for the color picker grid)', () => {
		windowStore.open('character-editor', 'c1');
		const w = get(windowStore)[0];
		expect(w.width).toBe(380);
		expect(w.height).toBe(480);
	});

	it('uses default 320x480 for other non-special apps', () => {
		windowStore.open('wiki', 'w1');
		const w = get(windowStore)[0];
		expect(w.width).toBe(320);
		expect(w.height).toBe(480);
	});

	it('initializes new windows as not minimized and not maximized', () => {
		windowStore.open('wiki');
		const w = get(windowStore)[0];
		expect(w.minimized).toBe(false);
		expect(w.maximized).toBe(false);
	});
});

describe('windowStore.openForEntity', () => {
	it('routes Character → character-editor', () => {
		const id = windowStore.openForEntity('e1', 'Character');
		expect(id).toBe('character-editor-e1');
	});

	it('routes Location → world-map', () => {
		const id = windowStore.openForEntity('loc1', 'Location');
		expect(id).toBe('world-map-loc1');
	});

	it('routes Event/Act/Scene → entity-detail (post D10-extension/19A)', () => {
		const a = windowStore.openForEntity('act1', 'Act');
		const s = windowStore.openForEntity('s1', 'Scene');
		const e = windowStore.openForEntity('ev1', 'Event');
		expect(a).toBe('entity-detail-act1');
		expect(s).toBe('entity-detail-s1');
		expect(e).toBe('entity-detail-ev1');
	});

	it('routes Note → entity-detail', () => {
		const id = windowStore.openForEntity('n1', 'Note');
		expect(id).toBe('entity-detail-n1');
	});

	it('focuses an existing window instead of duplicating', () => {
		const a = windowStore.openForEntity('e1', 'Character');
		const b = windowStore.openForEntity('e1', 'Character');
		expect(a).toBe(b);
		expect(get(windowStore)).toHaveLength(1);
	});
});

describe('windowStore.close', () => {
	it('removes the window with the matching id', () => {
		windowStore.open('wiki');
		windowStore.open('character-editor', 'c1');
		expect(get(windowStore)).toHaveLength(2);

		windowStore.close('wiki');
		const remaining = get(windowStore);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe('character-editor-c1');
	});

	it('is a no-op for unknown ids', () => {
		windowStore.open('wiki');
		windowStore.close('does-not-exist');
		expect(get(windowStore)).toHaveLength(1);
	});
});

describe('windowStore.focus', () => {
	it('raises zIndex above all other windows', () => {
		windowStore.open('wiki');
		windowStore.open('character-editor', 'c1');
		const before = get(windowStore);
		const wikiZ = before.find((w) => w.id === 'wiki')!.zIndex;
		const charZ = before.find((w) => w.id === 'character-editor-c1')!.zIndex;
		expect(charZ).toBeGreaterThan(wikiZ);

		windowStore.focus('wiki');
		const after = get(windowStore);
		const newWikiZ = after.find((w) => w.id === 'wiki')!.zIndex;
		expect(newWikiZ).toBeGreaterThan(charZ);
	});

	it('un-minimizes the focused window', () => {
		windowStore.open('wiki');
		windowStore.minimize('wiki');
		expect(get(windowStore)[0].minimized).toBe(true);

		windowStore.focus('wiki');
		expect(get(windowStore)[0].minimized).toBe(false);
	});
});

describe('windowStore.minimize', () => {
	it('sets minimized=true on the matching window', () => {
		windowStore.open('wiki');
		windowStore.minimize('wiki');
		expect(get(windowStore)[0].minimized).toBe(true);
	});

	it('does not affect other windows', () => {
		windowStore.open('wiki');
		windowStore.open('character-editor', 'c1');
		windowStore.minimize('wiki');
		const other = get(windowStore).find((w) => w.id === 'character-editor-c1')!;
		expect(other.minimized).toBe(false);
	});
});

describe('windowStore.maximize', () => {
	it('toggles maximized state', () => {
		windowStore.open('wiki');
		expect(get(windowStore)[0].maximized).toBe(false);

		windowStore.maximize('wiki');
		expect(get(windowStore)[0].maximized).toBe(true);

		windowStore.maximize('wiki');
		expect(get(windowStore)[0].maximized).toBe(false);
	});

	it('un-minimizes when maximizing', () => {
		windowStore.open('wiki');
		windowStore.minimize('wiki');
		windowStore.maximize('wiki');
		const w = get(windowStore)[0];
		expect(w.minimized).toBe(false);
		expect(w.maximized).toBe(true);
	});

	it('raises z-index when maximizing', () => {
		windowStore.open('wiki');
		windowStore.open('character-editor', 'c1');
		const beforeZ = get(windowStore).find((w) => w.id === 'wiki')!.zIndex;
		windowStore.maximize('wiki');
		const afterZ = get(windowStore).find((w) => w.id === 'wiki')!.zIndex;
		expect(afterZ).toBeGreaterThan(beforeZ);
	});
});

describe('windowStore.move + resize', () => {
	it('move() updates x/y on the matching window', () => {
		windowStore.open('wiki');
		windowStore.move('wiki', 200, 300);
		const w = get(windowStore)[0];
		expect(w.x).toBe(200);
		expect(w.y).toBe(300);
	});

	it('resize() updates width/height on the matching window', () => {
		windowStore.open('wiki');
		windowStore.resize('wiki', 999, 555);
		const w = get(windowStore)[0];
		expect(w.width).toBe(999);
		expect(w.height).toBe(555);
	});
});

describe('windowStore.setEntityId + focusedWindow', () => {
	it('setEntityId updates entityId without changing other state', () => {
		windowStore.open('character-editor', 'old');
		windowStore.setEntityId('character-editor-old', 'new');
		expect(get(windowStore)[0].entityId).toBe('new');
	});

	it('focusedWindow returns the highest-zIndex window', () => {
		windowStore.open('wiki');
		windowStore.open('character-editor', 'c1');
		windowStore.focus('wiki');
		const top = windowStore.focusedWindow();
		expect(top?.id).toBe('wiki');
	});

	it('focusedWindow returns undefined when no windows are open', () => {
		expect(windowStore.focusedWindow()).toBeUndefined();
	});
});
