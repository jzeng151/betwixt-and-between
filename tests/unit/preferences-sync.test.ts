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
	PreferencesVersionError,
	__setStorageForTesting,
	__reloadFromStorageForTesting
} from '../../src/lib/os/preferences-store.js';
import {
	hydratePreferences,
	applyPreferencePatch,
	onAuthChange,
	preferencesUserId,
	preferencesOwnershipResolved,
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

/** Minimal in-memory StorageLike for the owner-scoping tests. */
function memStorage(init: Record<string, string> = {}): any {
	const m = new Map(Object.entries(init));
	return {
		getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
		setItem: (k: string, v: string) => void m.set(k, v),
		removeItem: (k: string) => void m.delete(k)
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

describe('T4 first-login reconcile (codex)', () => {
	it('pushes localStorage prefs up on a fresh (uninitialized) row instead of clobbering', async () => {
		// Prefs loaded from localStorage land in the STORE but not in `pending`
		// (they never went through applyPreferencePatch) — the exact shape of an
		// existing user upgrading to server-backed prefs.
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, theme: 'light', accentColor: '#abc123' }
		});

		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();

		// Preserved, NOT overwritten by the empty server row's defaults.
		expect(get(preferences).appearance).toMatchObject({ theme: 'light', accentColor: '#abc123' });
		// And migrated up to the now-claimed server row.
		await __flushForTesting();
		const patch = calls.find((c) => c.method === 'PATCH');
		expect(patch?.body.set.appearance).toMatchObject({ theme: 'light', accentColor: '#abc123' });
		expect(__getServerVersionForTesting()).toBe(2);
	});

	it('pushes only deltas from defaults (untouched keys keep tracking defaults)', async () => {
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, accentColor: '#abc123' } // only accent changed
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		const patch = calls.find((c) => c.method === 'PATCH');
		// Only the user's actual deviation is sent — not theme (still default).
		expect(patch?.body.set.appearance).toEqual({ accentColor: '#abc123' });
	});

	it('marks a fresh row initialized even when local equals defaults (no appearance deltas)', async () => {
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		// Still PATCHes a bare schemaVersion stamp so the server marks the row
		// initialized (codex) — but carries no appearance overrides.
		const patches = calls.filter((c) => c.method === 'PATCH');
		expect(patches).toHaveLength(1);
		expect(patches[0].body.set).toEqual({ schemaVersion: PREFERENCES_CODE_MAX_VERSION });
		expect(patches[0].body.set.appearance).toBeUndefined();
	});

	it('does not reconcile when the server row is already initialized', async () => {
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, accentColor: '#abc123' }
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, {
						data: { schemaVersion: 4, appearance: { theme: 'light' } },
						version: 5,
						initialized: true
					})
				: fakeRes(200, { version: 6 })
		);
		await hydratePreferences();
		await __flushForTesting();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
		expect(get(preferences).appearance.theme).toBe('light');
	});
});

describe('T4 user-scoped cache (codex P1)', () => {
	const OWNER_KEY = 'btw:preferences:owner';

	it('does NOT import a different user\'s cached prefs into a fresh row', async () => {
		// Browser cache is owned by user A; user B now signs in with a fresh row.
		__setStorageForTesting(memStorage({ [OWNER_KEY]: 'user-A' }));
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, theme: 'light', accentColor: '#aaaaaa' }
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false, userId: 'user-B' })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		// No PATCH carrying A's theme/accent into B's row.
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
		// B sees defaults, not A's customizations.
		expect(get(preferences).appearance.accentColor).not.toBe('#aaaaaa');
	});

	it('discards pre-hydrate pending edits when the cache is foreign (codex)', async () => {
		__setStorageForTesting(memStorage({ [OWNER_KEY]: 'user-A' }));
		// Foreign cache content in the store + a pre-hydrate edit by the new user
		// (Settings can render before the GET resolves; serverVersion 0 → pending only).
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, accentColor: '#aaaaaa' }
		});
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, {
						data: { schemaVersion: 4, appearance: { theme: 'dark' } },
						version: 1,
						initialized: true,
						userId: 'user-B'
					})
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		// The pre-hydrate edit must NOT be written into the new user's row.
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
		// Store reflects the new user's server base, not the foreign edits.
		expect(get(preferences).appearance.theme).toBe('dark');
		expect(get(preferences).appearance.accentColor).not.toBe('#aaaaaa');
	});

	it('still reconciles when the cache is owned by the signed-in user', async () => {
		__setStorageForTesting(memStorage({ [OWNER_KEY]: 'user-B' }));
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, accentColor: '#abc123' }
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false, userId: 'user-B' })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		expect(calls.find((c) => c.method === 'PATCH')?.body.set.appearance.accentColor).toBe('#abc123');
		expect(get(preferences).appearance.accentColor).toBe('#abc123');
	});

	it('exposes the signed-in user id (for the SSR palette-cookie owner) and clears it on logout', async () => {
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: true, userId: 'user-B' })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		expect(get(preferencesUserId)).toBe('user-B');
		await onAuthChange('logout');
		expect(get(preferencesUserId)).toBeNull();
	});

	it('reconciles an unclaimed (legacy/anonymous) cache and stamps the owner', async () => {
		const store = memStorage();
		__setStorageForTesting(store);
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, accentColor: '#abc123' }
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false, userId: 'user-B' })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		expect(calls.find((c) => c.method === 'PATCH')?.body.set.appearance.accentColor).toBe('#abc123');
		// Cache is now claimed for the signed-in user.
		expect(store.getItem(OWNER_KEY)).toBe('user-B');
	});
});

describe('T4 transient-failure retry (codex)', () => {
	it('requeues and retries on a 5xx — the edit is not dropped', async () => {
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1, initialized: true });
			const patchCount = calls.filter((x) => x.method === 'PATCH').length;
			return patchCount === 1 ? fakeRes(503, {}) : fakeRes(200, { version: 2 });
		});
		await hydratePreferences();
		applyPreferencePatch({ set: { appearance: { accentColor: '#ff0000' } } });
		await __flushForTesting(); // PATCH#1 → 503 → requeue + scheduleRetry
		await __flushForTesting(); // PATCH#2 → 200 v2 (the retry path's work)
		expect(__getServerVersionForTesting()).toBe(2);
		const last = calls.filter((c) => c.method === 'PATCH').at(-1);
		expect(last?.body.set.appearance.accentColor).toBe('#ff0000');
	});

	it('requeues and retries on a 401 (session expired mid-session)', async () => {
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1, initialized: true });
			const patchCount = calls.filter((x) => x.method === 'PATCH').length;
			return patchCount === 1 ? fakeRes(401, {}) : fakeRes(200, { version: 2 });
		});
		await hydratePreferences();
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await __flushForTesting(); // 401 → requeue (not dropped)
		await __flushForTesting(); // retry → success
		expect(__getServerVersionForTesting()).toBe(2);
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body.set.appearance.theme).toBe(
			'light'
		);
	});

	it('keeps the ownership gate CLOSED through a transient hydrate failure, opens it on recovery (codex)', async () => {
		let gets = 0;
		mockFetch((c) => {
			if (c.method === 'GET') {
				gets++;
				if (gets === 1) throw new Error('network down');
				return fakeRes(200, { data: {}, version: 1, initialized: true, userId: 'u' });
			}
			return fakeRes(200, { version: 2 });
		});
		expect(get(preferencesOwnershipResolved)).toBe(false);
		await hydratePreferences(); // fails transiently → gate must stay CLOSED
		expect(get(preferencesOwnershipResolved)).toBe(false);
		await hydratePreferences(); // recovery → ownership resolved → gate opens
		expect(get(preferencesOwnershipResolved)).toBe(true);
	});

	it('opens the ownership gate on a definitive 401 (anonymous is resolved)', async () => {
		mockFetch(() => fakeRes(401, {}));
		await hydratePreferences();
		expect(get(preferencesOwnershipResolved)).toBe(true);
	});

	it('recovers a transiently-failed initial hydrate and flushes stranded edits (codex)', async () => {
		let gets = 0;
		mockFetch((c) => {
			if (c.method === 'GET') {
				gets++;
				if (gets === 1) throw new Error('network down'); // initial hydrate fails
				return fakeRes(200, { data: {}, version: 1, initialized: true, userId: 'u' });
			}
			return fakeRes(200, { version: 2 });
		});
		await hydratePreferences(); // GET#1 throws → offline, serverVersion 0, retry scheduled
		expect(__getServerVersionForTesting()).toBe(0);
		// Edit made while offline accumulates but cannot flush (serverVersion 0).
		applyPreferencePatch({ set: { appearance: { accentColor: '#abc123' } } });
		await __flushForTesting();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
		// The scheduled retry hydrate (invoked here directly) succeeds and the
		// stranded edit finally reaches the server.
		await hydratePreferences();
		await __flushForTesting();
		expect(__getServerVersionForTesting()).toBe(2);
		expect(calls.find((c) => c.method === 'PATCH')?.body.set.appearance.accentColor).toBe('#abc123');
	});

	it('drops the patch on a 400 (bad patch) without retrying', async () => {
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: true })
				: fakeRes(400, {})
		);
		await hydratePreferences();
		applyPreferencePatch({ set: { appearance: { accentColor: '#ff0000' } } });
		await __flushForTesting(); // PATCH → 400 → dropped
		await __flushForTesting(); // nothing pending → no retry
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
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

	it('switching to a user with a fresh (uninitialized) row does NOT leak the prior user prefs (codex)', async () => {
		// Previous account's prefs are in the store (as if loaded from a shared
		// browser localStorage). The new account's row is freshly created.
		preferences.set({
			...get(preferences),
			appearance: { ...get(preferences).appearance, theme: 'light', accentColor: '#abc123' }
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false })
				: fakeRes(200, { version: 2 })
		);
		await onAuthChange('switch');
		await __flushForTesting();
		// A bare schemaVersion marker PATCH may be sent, but it must NOT carry the
		// prior user's theme/accent into the new user's row.
		const patch = calls.find((c) => c.method === 'PATCH');
		expect(patch?.body.set.appearance).toBeUndefined();
		// New account sees defaults, not the previous user's customizations.
		expect(get(preferences).appearance.accentColor).not.toBe('#abc123');
	});
});

describe('T4 reconcile schema-version stamp (codex)', () => {
	it('always stamps code-max schemaVersion even when the local cache carries an older one', async () => {
		// Local store from a stale cache: schemaVersion below code-max plus a real
		// deviation, so diffFromBase includes schemaVersion in the delta.
		preferences.set({
			...get(preferences),
			schemaVersion: 0,
			appearance: { ...get(preferences).appearance, accentColor: '#abc123' }
		});
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, initialized: false })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();
		await __flushForTesting();
		const patch = calls.find((c) => c.method === 'PATCH');
		// The reconcile must not initialize the server row below code-max.
		expect(patch?.body.set.schemaVersion).toBe(PREFERENCES_CODE_MAX_VERSION);
		expect(patch?.body.set.appearance.accentColor).toBe('#abc123');
	});
});

describe('T4 downgrade-state recovery on hydrate (codex)', () => {
	it('clears versionError after a clean server hydrate so localStorage writes resume', async () => {
		// Boot tripped downgrade protection from a too-new localStorage payload.
		versionError.set(new PreferencesVersionError(99, PREFERENCES_CODE_MAX_VERSION));
		expect(get(versionError)).not.toBeNull();
		mockFetch(() =>
			fakeRes(200, { data: { schemaVersion: 4, appearance: { theme: 'dark' } }, version: 3, initialized: true })
		);
		await hydratePreferences();
		expect(get(versionError)).toBeNull();
	});

	it('still surfaces stale-app when the SERVER blob is newer than code (no false clear)', async () => {
		mockFetch(() =>
			fakeRes(200, { data: { schemaVersion: PREFERENCES_CODE_MAX_VERSION + 5 }, version: 9, initialized: true })
		);
		await hydratePreferences();
		expect(get(versionError)).not.toBeNull();
	});
});

describe('T4 editor prefs are local-only across hydrate (codex)', () => {
	it('preserves the local editor branch when an initialized server row lacks it', async () => {
		// User toggled editor off locally (setPreference, never synced) on an
		// already-initialized row whose server blob carries no editor subtree.
		preferences.set({
			...get(preferences),
			editor: { ...get(preferences).editor, linkPreviewEnabled: false }
		});
		mockFetch(() =>
			fakeRes(200, {
				data: { schemaVersion: 4, appearance: { theme: 'dark' } },
				version: 3,
				initialized: true
			})
		);
		await hydratePreferences();
		// Local editor toggle survives — not reset to the default (true).
		expect(get(preferences).editor.linkPreviewEnabled).toBe(false);
		// And it was not pushed to the server (local-only).
		await __flushForTesting();
		expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
	});
});
