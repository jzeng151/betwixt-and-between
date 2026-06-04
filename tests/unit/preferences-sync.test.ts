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
	switchProfile,
	createProfile,
	onAuthChange,
	preferencesUserId,
	preferencesProfileId,
	preferencesOwnershipResolved,
	__setFetchForTesting,
	__setDebounceForTesting,
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

describe('Phase 3 profile switch/create drains pending edits first', () => {
	const PROFILE_A = '11111111-1111-1111-1111-111111111111';
	const PROFILE_B = '22222222-2222-2222-2222-222222222222';

	// A large debounce guarantees the scheduled flush never fires on its own —
	// any PATCH we observe is the explicit drainBeforeSwitch flush, which is the
	// behaviour under test (it was a no-op while `switching` was set first).
	beforeEach(() => __setDebounceForTesting(100_000));

	it('switchProfile flushes the pending edit to the current profile before activating', async () => {
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A });
			if (c.method === 'PATCH') return fakeRes(200, { version: 2 });
			return fakeRes(200, { ok: true }); // POST activate
		});
		await hydratePreferences();

		// Edit, then switch WITHOUT waiting for the debounce — the edit is pending.
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await switchProfile(PROFILE_B);

		const patchIdx = calls.findIndex((c) => c.method === 'PATCH');
		const activateIdx = calls.findIndex((c) => c.method === 'POST');
		// The pending edit reached the server (was NOT silently dropped)…
		expect(patchIdx).toBeGreaterThanOrEqual(0);
		expect(calls[patchIdx].body.set.appearance.theme).toBe('light');
		// …and it landed on the OLD profile, before the activate flipped profiles.
		expect(calls[patchIdx].body.profileId).toBe(PROFILE_A);
		expect(patchIdx).toBeLessThan(activateIdx);
	});

	it('createProfile flushes the pending edit before the server copies the blob', async () => {
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A });
			if (c.method === 'PATCH') return fakeRes(200, { version: 2 });
			return fakeRes(200, { profileId: PROFILE_B, name: 'Fork', isActive: true, version: 1 });
		});
		await hydratePreferences();

		applyPreferencePatch({ set: { appearance: { accentColor: '#abcdef' } } });
		await createProfile('Fork');

		const patchIdx = calls.findIndex((c) => c.method === 'PATCH');
		const createIdx = calls.findIndex((c) => c.method === 'POST');
		expect(patchIdx).toBeGreaterThanOrEqual(0);
		expect(calls[patchIdx].body.set.appearance.accentColor).toBe('#abcdef');
		// The edit is flushed before the server copies the active blob into the fork.
		expect(patchIdx).toBeLessThan(createIdx);
	});

	// codex PR #69: a transient flush failure during the pre-switch drain must
	// NOT discard the edit, and the switch must abort (not proceed and let the
	// requeued patch reapply onto the next profile after re-hydrate).
	it('switchProfile aborts and preserves the pending edit when the pre-switch flush fails', async () => {
		let patchFails = true;
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A });
			if (c.method === 'PATCH') return patchFails ? fakeRes(500, {}) : fakeRes(200, { version: 2 });
			return fakeRes(200, { ok: true });
		});
		await hydratePreferences();

		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await expect(switchProfile(PROFILE_B)).rejects.toThrow(/could not save/);
		// The switch did not proceed…
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
		// …and the edit survived: a later successful flush still delivers it.
		patchFails = false;
		await __flushForTesting();
		const patches = calls.filter((c) => c.method === 'PATCH');
		expect(patches.at(-1)?.body.set.appearance.theme).toBe('light');
	});

	// codex PR #69: a profile-change 409 (active profile changed under us) must
	// DROP the old-profile patch, not requeue + replay it onto the new profile.
	it('drops a pending patch on a profile-change 409 instead of replaying it', async () => {
		let activeProfile = PROFILE_A;
		mockFetch((c) => {
			if (c.method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: activeProfile });
			if (c.method === 'PATCH')
				return fakeRes(409, { message: 'active profile changed; re-fetch and retry' });
			return fakeRes(200, { ok: true });
		});
		await hydratePreferences(); // active = PROFILE_A
		activeProfile = PROFILE_B; // server reports a different active profile on re-hydrate

		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await __flushForTesting(); // PATCH → 409 profile-change → drop + re-hydrate

		const patchesBefore = calls.filter((c) => c.method === 'PATCH').length;
		await __flushForTesting();
		// Nothing pending to replay — the old-profile edit was dropped, not re-sent.
		expect(calls.filter((c) => c.method === 'PATCH').length).toBe(patchesBefore);
	});

	// codex PR #69: a profile-change 409 must drop the WHOLE pending queue, not just
	// the drained patch — a second edit queued during the in-flight PATCH was also
	// authored against the old profile and would otherwise replay onto the new one.
	it('drops the whole pending queue on a profile-change 409', async () => {
		let releasePatch!: () => void;
		const gate = new Promise<void>((r) => (releasePatch = r));
		let activeProfile = PROFILE_A;
		__setFetchForTesting((async (_url: unknown, init: { method?: string; body?: string } | undefined) => {
			const method = init?.method ?? 'GET';
			const body = init?.body ? JSON.parse(init.body) : undefined;
			calls.push({ method, body });
			if (method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: activeProfile });
			return gate.then(() => fakeRes(409, { message: 'active profile changed; re-fetch and retry' }));
		}) as unknown as typeof fetch);
		await hydratePreferences();

		__setDebounceForTesting(0);
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } }); // patch1 → flush (gated)
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0)); // flush now in flight
		// A second edit queued while patch1 is in flight (authored against PROFILE_A).
		applyPreferencePatch({ set: { appearance: { accentColor: '#abcdef' } } });
		activeProfile = PROFILE_B; // the re-hydrate will report the new active profile

		releasePatch(); // patch1 → 409 profile-change → clears the whole queue, re-hydrates
		await new Promise((r) => setTimeout(r, 0));
		await __flushForTesting();
		// The queued second edit was dropped — never replayed onto PROFILE_B.
		expect(
			calls.filter((c) => c.method === 'PATCH' && c.body?.set?.appearance?.accentColor === '#abcdef')
		).toHaveLength(0);
	});

	// codex PR #69: after a profile-change 409 whose rehydrate fails transiently,
	// the client must enter limbo (serverVersion 0) so further edits are refused —
	// not left editable against the stale profile (stamp → another 409 → dropped).
	it('enters limbo after a profile-change 409 whose rehydrate fails', async () => {
		let hydrateOk = true;
		mockFetch((c) => {
			if (c.method === 'GET')
				return hydrateOk
					? fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A })
					: fakeRes(500, {}); // the post-409 rehydrate fails transiently
			return fakeRes(409, { message: 'active profile changed; re-fetch and retry' });
		});
		await hydratePreferences();

		hydrateOk = false;
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await __flushForTesting(); // PATCH → 409 → markUnhydrated + (failed) rehydrate
		expect(get(preferencesProfileId)).toBe(null); // limbo

		const patchesBefore = calls.filter((c) => c.method === 'PATCH').length;
		applyPreferencePatch({ set: { appearance: { accentColor: '#abcdef' } } });
		await __flushForTesting();
		// Refused: accent never applied, no PATCH stamped against the stale profile.
		expect(get(preferences).appearance.accentColor).not.toBe('#abcdef');
		expect(calls.filter((c) => c.method === 'PATCH').length).toBe(patchesBefore);
	});

	// codex PR #69: a save already in flight must finish before the activate, or
	// it lands after and is dropped by the profile-change guard.
	it('switchProfile waits for an in-flight save before activating', async () => {
		let releasePatch!: () => void;
		const patchGate = new Promise<void>((r) => (releasePatch = r));
		const order: string[] = [];
		__setFetchForTesting((async (_url: unknown, init: { method?: string } | undefined) => {
			const method = init?.method ?? 'GET';
			if (method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A });
			if (method === 'PATCH') {
				order.push('patch-start');
				await patchGate;
				order.push('patch-done');
				return fakeRes(200, { version: 2 });
			}
			order.push('activate');
			return fakeRes(200, { ok: true });
		}) as unknown as typeof fetch);
		await hydratePreferences();

		__setDebounceForTesting(0);
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		// Let the debounced flush launch and block inside the awaiting PATCH.
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		const switchP = switchProfile(PROFILE_B);
		await new Promise((r) => setTimeout(r, 0));
		// The activate must NOT fire while the save is still in flight.
		expect(order).not.toContain('activate');

		releasePatch();
		await switchP;
		expect(order.indexOf('activate')).toBeGreaterThan(order.indexOf('patch-done'));
	});

	// codex PR #69: if the post-activate hydrate fails transiently, edits must not
	// be stamped with the OLD profile id (and dropped) — writes stay suppressed
	// until a successful re-hydrate.
	it('a failed post-activate hydrate suppresses writes until re-hydrate', async () => {
		let phase: 'pre' | 'post' = 'pre';
		mockFetch((c) => {
			if (c.method === 'GET')
				return phase === 'pre'
					? fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A })
					: fakeRes(500, {}); // post-activate hydrate fails transiently
			if (c.method === 'POST') {
				phase = 'post';
				return fakeRes(200, { ok: true });
			}
			return fakeRes(200, { version: 2 }); // PATCH — must not happen
		});
		await hydratePreferences(); // version 1, profile A

		// activate ok, post-activate hydrate 500s → switch is unresolved (rejects).
		await expect(switchProfile(PROFILE_B)).rejects.toThrow(/could not load it/);

		const patchesBefore = calls.filter((c) => c.method === 'PATCH').length;
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		await __flushForTesting();
		// In post-switch limbo the edit is REFUSED (not just unflushed): the store
		// still holds the previous profile, so applying against it would be stale.
		// theme stays the hydrated default ('dark'), and no PATCH was queued/sent.
		expect(calls.filter((c) => c.method === 'PATCH').length).toBe(patchesBefore);
		expect(get(preferences).appearance.theme).toBe('dark');
		expect(get(preferencesProfileId)).toBe(null);
	});

	// codex PR #69: an apply-preset whole-subtree unset queued beneath a later
	// descendant set must be canceled, or the server (set-then-unset) wipes the edit.
	it('a later descendant set cancels a queued ancestor unset', async () => {
		mockFetch((c) =>
			c.method === 'GET'
				? fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A })
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences();

		// Apply-preset shape: set appearance + unset a whole color-map subtree…
		applyPreferencePatch({
			set: { appearance: { theme: 'dark' } },
			unset: ['appearance.entityTypeColors']
		});
		// …then a quick edit under that subtree before the (large-debounce) flush.
		applyPreferencePatch({ set: { appearance: { entityTypeColors: { Character: '#abcdef' } } } });
		await __flushForTesting();

		const body = calls.filter((c) => c.method === 'PATCH').at(-1)!.body;
		expect(body.unset).not.toContain('appearance.entityTypeColors'); // ancestor unset canceled
		expect(body.set.appearance.entityTypeColors.Character).toBe('#abcdef'); // edit survives
	});

	// codex PR #69: an edit attempted while a switch is in flight is REFUSED (not
	// applied or queued) — the store still holds the old profile, so the edit would
	// be authored against it and replayed onto the new profile by the hydrate.
	it('refuses edits made while a profile switch is in flight', async () => {
		let releaseActivate!: () => void;
		const gate = new Promise<void>((r) => (releaseActivate = r));
		__setFetchForTesting((async (_url: unknown, init: { method?: string } | undefined) => {
			const method = init?.method ?? 'GET';
			const body = (init as { body?: string } | undefined)?.body
				? JSON.parse((init as { body: string }).body)
				: undefined;
			calls.push({ method, body });
			if (method === 'GET') return fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A });
			if (method === 'POST') return gate.then(() => fakeRes(200, { ok: true }));
			return fakeRes(200, { version: 2 }); // PATCH
		}) as unknown as typeof fetch);
		await hydratePreferences();

		const switchP = switchProfile(PROFILE_B);
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		// Edit arrives while `switching` is true → refused (store unchanged).
		const themeBefore = get(preferences).appearance.theme;
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		expect(get(preferences).appearance.theme).toBe(themeBefore);

		releaseActivate();
		await switchP;
		await __flushForTesting();
		// The refused edit never became a PATCH on the new profile.
		expect(
			calls.filter((c) => c.method === 'PATCH' && c.body?.set?.appearance?.theme === 'light')
		).toHaveLength(0);
	});

	// codex PR #69: before the initial hydrate (serverVersion 0, never reconciled),
	// switch/create must refuse — else a create copies the empty server Default and
	// the hydrate overwrites the user's unsynced local prefs.
	it('switchProfile/createProfile refuse before the initial hydrate', async () => {
		// No hydratePreferences() in this test → hasHydratedOnce is false.
		await expect(createProfile('X')).rejects.toThrow(/still loading/);
		await expect(switchProfile(PROFILE_B)).rejects.toThrow(/still loading/);
		// Refused before any network call.
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
	});

	// codex PR #69: switch/create must be refused while in post-switch limbo
	// (serverVersion 0 after a failed post-activate hydrate), not just pre-initial-
	// hydrate — else the create forks whatever profile is active server-side.
	it('refuses switch/create while in post-switch limbo', async () => {
		let phase: 'pre' | 'post' = 'pre';
		mockFetch((c) => {
			if (c.method === 'GET')
				return phase === 'pre'
					? fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A })
					: fakeRes(500, {});
			if (c.method === 'POST') {
				phase = 'post';
				return fakeRes(200, { ok: true });
			}
			return fakeRes(200, { version: 2 });
		});
		await hydratePreferences();

		// Enter limbo: activate ok, post-activate hydrate 500s.
		await expect(switchProfile(PROFILE_B)).rejects.toThrow(/could not load it/);
		// In limbo (serverVersion 0) a further switch/create is refused.
		await expect(createProfile('X')).rejects.toThrow(/still loading/);
	});

	// codex PR #69: a definitive 401 after a prior hydrate returns to local-only
	// (anonymous) mode — the limbo guard must NOT keep dropping edits.
	it('a 401 after hydrating re-enables local-only edits (not stuck in limbo)', async () => {
		let phase: 'ok' | 'expired' = 'ok';
		mockFetch((c) =>
			c.method === 'GET'
				? phase === 'ok'
					? fakeRes(200, { data: {}, version: 1, profileId: PROFILE_A })
					: fakeRes(401, {})
				: fakeRes(200, { version: 2 })
		);
		await hydratePreferences(); // 200 → hasHydratedOnce true
		phase = 'expired';
		await hydratePreferences(); // 401 → serverVersion 0, hasHydratedOnce reset

		// The localStorage-only contract: a local edit still applies optimistically.
		applyPreferencePatch({ set: { appearance: { theme: 'light' } } });
		expect(get(preferences).appearance.theme).toBe('light');
	});
});
