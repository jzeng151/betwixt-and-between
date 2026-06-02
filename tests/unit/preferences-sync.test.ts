/**
 * Settings customization Phase 1 — T4 sync controller (preferences-sync.ts).
 *
 * Drives the controller with an injected fetch + forced flush (no real timers).
 * Covers: hydrate apply + version, 401 anonymous (no server writes), newer-than-
 * code downgrade protection, optimistic+debounced PATCH, the 409 reconciliation
 * (no lost update), dirty-before-hydrate, and auth transitions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	preferences,
	versionError,
	__setStorageForTesting,
	__reloadFromStorageForTesting
} from '../../src/lib/os/preferences-store.js';
import {
	hydratePreferences,
	applyPreferencePatch,
	onAuthChange,
	__setFetchForTesting,
	__resetSyncForTesting,
	__flushForTesting,
	__getServerVersionForTesting
} from '../../src/lib/os/preferences-sync.js';
import { PREFERENCES_CODE_MAX_VERSION } from '../../src/lib/types/preferences.js';

interface Call {
	method: string;
	body?: any;
}
let calls: Call[];

function fakeRes(status: number, body: unknown): any {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body)
	};
}

/** Install a fetch mock; `handler` returns the Response for each call. */
function mockFetch(handler: (c: Call & { index: number }) => any) {
	__setFetchForTesting((async (_url: any, init: any) => {
		const method = (init?.method ?? 'GET') as string;
		const body = init?.body ? JSON.parse(init.body as string) : undefined;
		const index = calls.length;
		calls.push({ method, body });
		return handler({ method, body, index });
	}) as any);
}

beforeEach(() => {
	calls = [];
	__setStorageForTesting(null);
	__reloadFromStorageForTesting();
	__resetSyncForTesting();
});

describe('T4 hydratePreferences', () => {
	it('applies the migrated server blob and records the version', async () => {
		mockFetch(() =>
			fakeRes(200, {
				data: { schemaVersion: 4, appearance: { theme: 'light', accentColor: '#aabbcc' } },
				version: 7
			})
		);
		await hydratePreferences();
		expect(get(preferences).appearance.theme).toBe('light');
		expect(get(preferences).appearance.accentColor).toBe('#aabbcc');
		expect(__getServerVersionForTesting()).toBe(7);
	});

	it('401 → anonymous: no server writes attempted on later patches', async () => {
		mockFetch(() => fakeRes(401, {}));
		await hydratePreferences();
		expect(__getServerVersionForTesting()).toBe(0);
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await __flushForTesting();
		// Only the GET happened; no PATCH (serverVersion 0).
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
		// Local store still updated optimistically.
		expect(get(preferences).appearance.theme).toBe('light');
	});

	it('newer-than-code server blob → downgrade protection (versionError, no writes)', async () => {
		mockFetch(() =>
			fakeRes(200, { data: { schemaVersion: PREFERENCES_CODE_MAX_VERSION + 5 }, version: 9 })
		);
		await hydratePreferences();
		expect(get(versionError)).not.toBeNull();
		expect(__getServerVersionForTesting()).toBe(0);
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await __flushForTesting();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
	});
});

describe('T4 applyPreferencePatch', () => {
	it('updates locally immediately and PATCHes with set+version (schemaVersion stamped)', async () => {
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1 })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		applyPreferencePatch({ set: { appearance: { accentColor: '#123456' } } });
		// optimistic, before flush
		expect(get(preferences).appearance.accentColor).toBe('#123456');
		await __flushForTesting();
		const patch = calls.find((c) => c.method === 'PATCH');
		expect(patch?.body).toMatchObject({
			set: { schemaVersion: PREFERENCES_CODE_MAX_VERSION, appearance: { accentColor: '#123456' } },
			version: 1
		});
		expect(__getServerVersionForTesting()).toBe(2);
	});

	it('coalesces multiple edits into one PATCH within the debounce window', async () => {
		mockFetch((c) =>
			c.method === 'GET' ? fakeRes(200, { data: {}, version: 1 }) : fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		applyPreferencePatch({ set: { appearance: { accentColor: '#abcdef' } } });
		await __flushForTesting();
		const patches = calls.filter((c) => c.method === 'PATCH');
		expect(patches).toHaveLength(1);
		expect(patches[0].body.set.appearance).toMatchObject({ theme: 'light', accentColor: '#abcdef' });
	});
});

describe('T4 409 reconciliation', () => {
	it('re-hydrates and retries on 409 with no lost update', async () => {
		// GET#1 → empty v1; PATCH#1 → 409; GET#2 (re-hydrate) → another writer set
		// theme at v2; PATCH#2 → success v3.
		mockFetch((c) => {
			if (c.method === 'GET') {
				const getCount = calls.filter((x) => x.method === 'GET').length; // includes this call
				return getCount === 1
					? fakeRes(200, { data: {}, version: 1 })
					: fakeRes(200, {
							data: { schemaVersion: 4, appearance: { theme: 'light' } },
							version: 2
						});
			}
			// PATCH
			const patchCount = calls.filter((x) => x.method === 'PATCH').length;
			return patchCount === 1 ? fakeRes(409, {}) : fakeRes(200, { version: 3 });
		});

		await hydratePreferences(); // v1
		applyPreferencePatch({ set: { appearance: { accentColor: '#abcdef' } } });
		await __flushForTesting(); // PATCH#1 → 409 → re-hydrate (GET#2) → schedule retry
		await __flushForTesting(); // PATCH#2 → 200 v3

		expect(__getServerVersionForTesting()).toBe(3);
		// No lost update: the other writer's theme AND our accent both present.
		expect(get(preferences).appearance).toMatchObject({
			theme: 'light',
			accentColor: '#abcdef'
		});
		const lastPatch = calls.filter((c) => c.method === 'PATCH').at(-1);
		expect(lastPatch?.body.version).toBe(2); // retried against the fresh base
		expect(lastPatch?.body.set.appearance.accentColor).toBe('#abcdef');
	});

	it('keeps the newer edit when one lands DURING an in-flight PATCH that 409s', async () => {
		// Regression: the requeue path must lay the drained (older) patch BENEATH
		// the edit that accumulated while it was in flight, not on top — otherwise
		// the user's most recent color silently reverts (lost update). Here RED is
		// in flight when the user picks BLUE; PATCH#1 then 409s. BLUE must win.
		let injected = false;
		mockFetch((c) => {
			if (c.method === 'GET') {
				const getCount = calls.filter((x) => x.method === 'GET').length;
				return getCount === 1
					? fakeRes(200, { data: {}, version: 1 })
					: fakeRes(200, { data: { schemaVersion: 4 }, version: 2 });
			}
			const patchCount = calls.filter((x) => x.method === 'PATCH').length;
			if (patchCount === 1) {
				if (!injected) {
					injected = true; // newer edit lands mid-flight
					applyPreferencePatch({ set: { appearance: { accentColor: '#0000ff' } } });
				}
				return fakeRes(409, {});
			}
			return fakeRes(200, { version: 3 });
		});

		await hydratePreferences(); // v1
		applyPreferencePatch({ set: { appearance: { accentColor: '#ff0000' } } }); // RED
		await __flushForTesting(); // PATCH#1(RED) → inject BLUE → 409 → requeue → re-hydrate
		await __flushForTesting(); // PATCH#2(BLUE) → 200 v3

		expect(get(preferences).appearance.accentColor).toBe('#0000ff'); // BLUE survived
		const lastPatch = calls.filter((c) => c.method === 'PATCH').at(-1);
		expect(lastPatch?.body.set.appearance.accentColor).toBe('#0000ff');
		expect(__getServerVersionForTesting()).toBe(3);
	});

	it('keeps the newer edit when one lands DURING an in-flight PATCH that fails (network)', async () => {
		// Same inversion guard for the network-failure requeue branch.
		let injected = false;
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1 });
			const patchCount = calls.filter((x) => x.method === 'PATCH').length;
			if (patchCount === 1) {
				if (!injected) {
					injected = true;
					applyPreferencePatch({ set: { appearance: { accentColor: '#0000ff' } } });
				}
				throw new Error('network down'); // fetch rejects → catch → requeue
			}
			return fakeRes(200, { version: 2 });
		});

		await hydratePreferences(); // v1
		applyPreferencePatch({ set: { appearance: { accentColor: '#ff0000' } } }); // RED
		await __flushForTesting(); // PATCH#1(RED) → inject BLUE → throw → requeue → offline
		await __flushForTesting(); // PATCH#2(BLUE) → 200 v2

		expect(get(preferences).appearance.accentColor).toBe('#0000ff');
		const lastPatch = calls.filter((c) => c.method === 'PATCH').at(-1);
		expect(lastPatch?.body.set.appearance.accentColor).toBe('#0000ff'); // not reverted to RED
	});
});

describe('T4 dirty-before-hydrate', () => {
	it('re-applies local edits made before hydrate onto the server base', async () => {
		// A local edit happens before we ever hydrate (serverVersion 0 → local only).
		applyPreferencePatch({ set: { appearance: { accentColor: '#ff00ff' } } });
		expect(get(preferences).appearance.accentColor).toBe('#ff00ff');

		// Now hydrate: server has a theme but not our accent.
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: { schemaVersion: 4, appearance: { theme: 'light' } }, version: 1 })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();

		// Server theme applied AND our pending accent preserved (not clobbered).
		expect(get(preferences).appearance).toMatchObject({
			theme: 'light',
			accentColor: '#ff00ff'
		});
		// And the pending edit gets flushed up.
		await __flushForTesting();
		const patch = calls.find((c) => c.method === 'PATCH');
		expect(patch?.body.set.appearance.accentColor).toBe('#ff00ff');
	});
});

describe('T4 auth transitions', () => {
	it('logout stops pending writes', async () => {
		mockFetch((c) =>
			c.method === 'GET' ? fakeRes(200, { data: {}, version: 1 }) : fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await onAuthChange('logout');
		await __flushForTesting();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
		expect(__getServerVersionForTesting()).toBe(0);
	});

	it('user switch clears state and re-hydrates', async () => {
		mockFetch((c) =>
			c.method === 'GET' ? fakeRes(200, { data: { schemaVersion: 4 }, version: 5 }) : fakeRes(200, { version: 6 })
		);
		await hydratePreferences();
		await onAuthChange('switch');
		// Re-hydrated → two GETs, fresh version from the switch.
		expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
		expect(__getServerVersionForTesting()).toBe(5);
	});
});
