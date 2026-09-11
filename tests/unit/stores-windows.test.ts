import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { windowStore } from '../../src/lib/os/windows-store.js';
import { preferences } from '../../src/lib/os/preferences-store.js';
import { PREFERENCES_DEFAULTS, type WindowsPrefs } from '../../src/lib/types/preferences.js';

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
		const b = windowStore.open('story-graph');
		expect(a).not.toBe(b);
		expect(get(windowStore).map((w) => w.id)).toEqual([a, b]);
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
		// 'notes' is the smallest fall-through case — every other appId
		// has a width-specific branch (timeline 960, world-map 1024, wiki 980,
		// settings 520, entity-detail 480, character-editor 380,
		// story-graph/focused-graph 640).
		windowStore.open('notes');
		const w = get(windowStore)[0];
		expect(w.width).toBe(320);
		expect(w.height).toBe(450);
	});

	it('initializes new windows as not minimized and not maximized', () => {
		windowStore.open('wiki');
		const w = get(windowStore)[0];
		expect(w.minimized).toBe(false);
		expect(w.maximized).toBe(false);
	});
});

describe('windowStore.openForEntity', () => {
	it('routes Character → entity-detail', () => {
		const id = windowStore.openForEntity('e1', 'Character');
		expect(id).toBe('entity-detail-e1');
	});

	it('routes Location → entity-detail', () => {
		const id = windowStore.openForEntity('loc1', 'Location');
		expect(id).toBe('entity-detail-loc1');
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

describe('windowStore — Item 3 window geometry defaults', () => {
	function setWindowDefaults(windows: WindowsPrefs) {
		preferences.set({ ...PREFERENCES_DEFAULTS, windows });
	}
	beforeEach(() => {
		const all = get(windowStore);
		for (const w of all) windowStore.close(w.id);
		preferences.set({ ...PREFERENCES_DEFAULTS });
	});

	it('applies a saved SIZE default on open (all AppIds)', () => {
		setWindowDefaults({ defaults: { wiki: { width: 900, height: 650 } } });
		windowStore.open('wiki');
		const w = get(windowStore)[0];
		expect(w.width).toBe(900);
		expect(w.height).toBe(650);
	});

	it('applies a saved POSITION for a single-instance app', () => {
		setWindowDefaults({ defaults: { wiki: { width: 600, height: 500, x: 120, y: 90 } } });
		windowStore.open('wiki');
		const w = get(windowStore)[0];
		expect(w.x).toBe(120);
		expect(w.y).toBe(90);
	});

	it('ignores a saved position for a multi-instance app (keeps stagger)', () => {
		setWindowDefaults({ defaults: { 'story-graph': { width: 700, height: 600, x: 500, y: 500 } } });
		windowStore.open('story-graph');
		const w = get(windowStore)[0];
		// Size still applied...
		expect(w.width).toBe(700);
		expect(w.height).toBe(600);
		// ...but position came from the open-stagger, not the saved x/y.
		expect(w.x).not.toBe(500);
	});

	it('clamps an off-screen saved position to the viewport on open', () => {
		// These unit tests run in node (no DOM); the clamp is browser-only, so
		// stub the minimal window/document surface it reads.
		vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768 });
		vi.stubGlobal('document', { documentElement: {} });
		vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '52' }));
		try {
			setWindowDefaults({ defaults: { settings: { width: 520, height: 400, x: 99999, y: 99999 } } });
			windowStore.open('settings');
			const w = get(windowStore)[0];
			expect(w.x + w.width).toBeLessThanOrEqual(1024);
			expect(w.y + w.height).toBeLessThanOrEqual(768 - 52);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// Regression: ISSUE-001 — world-map tool palette unclickable on short viewports
	// Found by /qa on 2026-06-05
	// Report: .gstack/qa-reports/qa-report-localhost-2026-06-05.md
	// A window taller than (innerHeight - taskbar) used to clamp position to 0
	// and spill its bottom under the fixed taskbar, occluding the bottom-anchored
	// map tool palette (Brush/Place/Move). clampOpenGeom now caps size to fit.
	it('caps an opened window taller than the usable viewport so it clears the taskbar', () => {
		// world-map default is 1024x720; at innerHeight 720 the usable area is
		// 720 - 52 = 668, so the window must shrink to fit above the taskbar.
		vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
		vi.stubGlobal('document', { documentElement: {} });
		vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '52' }));
		try {
			windowStore.open('world-map');
			const w = get(windowStore)[0];
			expect(w.height).toBeLessThanOrEqual(720 - 52);
			// the full window (top + height) stays above the taskbar
			expect(w.y + w.height).toBeLessThanOrEqual(720 - 52);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('leaves window size untouched when the viewport is tall enough', () => {
		vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 1000 });
		vi.stubGlobal('document', { documentElement: {} });
		vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '52' }));
		try {
			windowStore.open('world-map');
			const w = get(windowStore)[0];
			// 720 fits within 1000 - 52 = 948, so the default height is preserved.
			expect(w.width).toBe(1024);
			expect(w.height).toBe(720);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('setAsDefault persists size for a multi-instance app but not position', () => {
		const id = windowStore.open('story-graph');
		windowStore.resize(id, 800, 700);
		windowStore.move(id, 333, 222);
		windowStore.setAsDefault(id);
		const saved = get(preferences).windows.defaults['story-graph'];
		expect(saved).toEqual({ width: 800, height: 700 });
		expect(saved?.x).toBeUndefined();
	});

	it('setAsDefault persists size + position for a single-instance app', () => {
		const id = windowStore.open('wiki');
		windowStore.resize(id, 850, 640);
		windowStore.move(id, 70, 80);
		windowStore.setAsDefault(id);
		expect(get(preferences).windows.defaults.wiki).toEqual({ width: 850, height: 640, x: 70, y: 80 });
	});
});

describe('window keyboard navigation', () => {
	it('cycles in both directions through every visible window and skips minimized windows', () => {
		windowStore.open('wiki');
		windowStore.open('notes');
		windowStore.open('settings');
		windowStore.open('timeline');
		windowStore.minimize('notes');
		for (const id of ['wiki', 'settings', 'timeline', 'wiki']) {
			windowStore.cycle(1);
			expect(windowStore.focusedWindow()?.id).toBe(id);
		}
		for (const id of ['timeline', 'settings', 'wiki', 'timeline']) {
			windowStore.cycle(-1);
			expect(windowStore.focusedWindow()?.id).toBe(id);
		}
	});

	it('never selects a minimized window as the close-shortcut target', () => {
		windowStore.open('wiki');
		windowStore.open('notes');
		windowStore.minimize('notes');
		expect(windowStore.focusedWindow()?.id).toBe('wiki');
		expect(windowStore.cycle(1)).toBe(false);
		expect(windowStore.cycle(-1)).toBe(false);
		windowStore.minimize('wiki');
		expect(windowStore.cycle(1)).toBe(false);
		expect(windowStore.cycle(-1)).toBe(false);
		expect(windowStore.focusedWindow()).toBeUndefined();
	});
});

describe('tab window restoration', () => {
	let saved: Map<string, string>;
	let stop: (() => void) | undefined;
	beforeEach(() => {
		saved = new Map();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => saved.get(key) ?? null,
			setItem: (key: string, value: string) => saved.set(key, value)
		});
		vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 }));
		vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: {}, visibilityState: 'hidden' }));
		vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '44' }));
	});
	afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); });

	it('restores entity selection, independent graph IDs, stacking and minimized state with visible geometry', () => {
		stop = windowStore.startSession('user-a');
		windowStore.open('wiki');
		windowStore.setEntityId('wiki', 'character-1');
		windowStore.move('wiki', 700, 600);
		windowStore.resize('wiki', 720, 500);
		const first = windowStore.openFocusedGraph(['character-1'], 'shared');
		const second = windowStore.openFocusedGraph(['location-1']);
		windowStore.setTypeOrder(first, ['Location', 'Character']);
		windowStore.togglePin(first);
		windowStore.open('notes');
		windowStore.minimize('notes');
		windowStore.focus(second);
		window.dispatchEvent(new Event('pagehide'));
		stop();
		stop = windowStore.startSession('user-a');
		const windows = get(windowStore);
		expect(windows.map((w) => w.id)).toEqual(['wiki', first, second, 'notes']);
		expect(windows[0]).toMatchObject({ entityId: 'character-1', x: 80, y: 56, width: 720, height: 500, geomAdjusted: true });
		expect(windows[1]).toMatchObject({ focalSet: ['character-1'], viewMode: 'shared', typeOrder: ['Location', 'Character'], alwaysOnTop: true });
		expect(windows[3].minimized).toBe(true);
		expect(windowStore.focusedWindow()?.id).toBe(second);
		windowStore.open('settings');
		expect(windowStore.focusedWindow()?.id).toBe('settings');
		windowStore.close('wiki');
		stop();
		stop = windowStore.startSession('user-a');
		expect(get(windowStore).some((w) => w.id === 'wiki')).toBe(false);
	});

	it('rejects another account, corrupt records and duplicates without blocking valid windows', () => {
		windowStore.open('wiki');
		const valid = get(windowStore)[0];
		for (const value of ['{broken', JSON.stringify({ userId: 'user-b', windows: [valid] })]) {
			saved.set('betwixt-windows-v1', value);
			stop = windowStore.startSession('user-a');
			expect(get(windowStore)).toEqual([]);
			stop();
		}
		saved.set('betwixt-windows-v1', JSON.stringify({ userId: 'user-a', windows: [
			{ ...valid, appId: 'unknown' }, { ...valid, width: -1 }, { ...valid, x: null },
			{ ...valid, id: '../../bad' }, { ...valid, zIndex: 1e100 }, valid, valid
		] }));
		stop = windowStore.startSession('user-a');
		expect(get(windowStore).map((w) => w.id)).toEqual(['wiki']);
	});

	it('keeps windows usable when browser storage is disabled', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => { throw new Error('Blocked'); },
			setItem: () => { throw new Error('Blocked'); }
		});
		stop = windowStore.startSession('user-a');
		windowStore.open('wiki');
		window.dispatchEvent(new Event('pagehide'));
		expect(windowStore.focusedWindow()?.id).toBe('wiki');
	});
});
