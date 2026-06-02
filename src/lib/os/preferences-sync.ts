/**
 * Server-sync controller for the preferences store (Settings customization
 * Phase 1, T4 — Approach B).
 *
 * The `preferences` writable (preferences-store.ts) stays the LOCAL optimistic
 * state + localStorage cache. This controller is the ONLY thing that talks to
 * /api/preferences. Because the store's subscribe-to-self never PATCHes, the
 * "hydrate set() echoes as a PATCH" loop is structurally impossible — server
 * writes happen exclusively through applyPreferencePatch(). The guards the
 * design called for map here as:
 *   • echo loop          → eliminated by construction (no auto-PATCH on set)
 *   • migrate-on-hydrate  → hydrate runs migrateAndMerge on the server blob
 *   • downgrade protect   → PreferencesVersionError from migrateAndMerge stops writes
 *   • dirty-before-hydrate→ pending local edits are re-applied onto the hydrated base
 *   • auth-transition     → onAuthChange clears pending + version (logout / user switch)
 *
 * Concurrency: every PATCH carries the last server `version`. A 409 means a
 * racing writer bumped it; we re-hydrate the base, re-apply our pending patch,
 * and retry — no lost update (server-side correctness is in user-preferences.ts).
 */

import { get, writable, type Readable } from 'svelte/store';
import { preferences, migrateAndMerge, PreferencesVersionError, versionError } from './preferences-store.js';
import { deepMerge, applyUnset, isPlainObject, diffFromBase } from '../preferences-merge.js';
import {
	PREFERENCES_CODE_MAX_VERSION,
	PREFERENCES_DEFAULTS,
	type Preferences
} from '../types/preferences.js';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'stale-app';

interface PendingPatch {
	set: Record<string, unknown>;
	unset: string[];
}

// ── module state ──────────────────────────────────────────────────────────
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
let debounceMs = 400;
let serverVersion = 0; // 0 = not hydrated / anonymous (no server writes)
let pending: PendingPatch = { set: {}, unset: [] };
let inFlight = false;
let hydrating = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// Transient-failure retry (network down / 5xx / session-expired): the optimistic
// edit is already applied locally; we requeue it and retry with capped backoff so
// it eventually reaches the server without a fresh user edit. Reset on any success.
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryBackoffMs = RETRY_BASE_MS;

const _status = writable<SyncStatus>('idle');
export const preferencesSyncStatus: Readable<SyncStatus> = { subscribe: _status.subscribe };

// ── test hooks ──────────────────────────────────────────────────────────────
export function __setFetchForTesting(f: typeof fetch): void {
	fetchImpl = f;
}
export function __setDebounceForTesting(ms: number): void {
	debounceMs = ms;
}
export function __resetSyncForTesting(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = null;
	retryBackoffMs = RETRY_BASE_MS;
	serverVersion = 0;
	pending = { set: {}, unset: [] };
	inFlight = false;
	hydrating = false;
	_status.set('idle');
}
/** Cancel the debounce and flush synchronously (await). For tests. */
export async function __flushForTesting(): Promise<void> {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	await flush();
}
export function __getServerVersionForTesting(): number {
	return serverVersion;
}

// ── pending accumulation (net effect of un-synced local edits) ───────────────
function leafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
	const out: string[] = [];
	for (const [k, v] of Object.entries(obj)) {
		const p = prefix ? `${prefix}.${k}` : k;
		if (isPlainObject(v)) out.push(...leafPaths(v, p));
		else out.push(p);
	}
	return out;
}

function accumulate(patch: PendingPatch): void {
	if (patch.set && Object.keys(patch.set).length > 0) {
		// A set of a path cancels a pending unset of the same path.
		const paths = leafPaths(patch.set);
		pending.unset = pending.unset.filter((u) => !paths.includes(u));
		pending.set = deepMerge(pending.set, patch.set);
	}
	for (const p of patch.unset ?? []) {
		// An unset of a path cancels its pending set and records the delete.
		pending.set = applyUnset(pending.set, [p]);
		if (!pending.unset.includes(p)) pending.unset.push(p);
	}
}

/**
 * Re-insert an OLDER (already-drained) patch BENEATH the current pending edits.
 * `accumulate` assumes its argument is NEWER than pending (it merges on top);
 * the flush failure paths (409 / network) need the mirror: a patch that was in
 * flight is older than any edit the user made meanwhile, so it must lose on
 * conflict. We achieve newer-on-top by laying the old patch down first, then
 * replaying the captured-newer edits over it — reusing accumulate's set/unset
 * cancellation so there is no second merge implementation to keep in sync.
 * Without this, re-merging the old patch on top silently reverted the user's
 * most recent edit (lost update).
 */
function requeue(patch: PendingPatch): void {
	const newer = pending;
	pending = { set: {}, unset: [] };
	accumulate(patch); // older, underneath
	accumulate(newer); // newer, on top — wins on conflict
}

function hasPending(): boolean {
	return Object.keys(pending.set).length > 0 || pending.unset.length > 0;
}

function drainPending(): PendingPatch {
	const drained = pending;
	pending = { set: {}, unset: [] };
	return drained;
}

function reapplyOntoBase(base: Preferences): Preferences {
	return applyUnset(deepMerge(base, pending.set), pending.unset);
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Fetch the server blob, migrate it, and apply to the local store. Any local
 * edits still pending (made before/during this round-trip) are re-applied on
 * top so they are not clobbered (dirty-before-hydrate). 401 → anonymous: stay
 * localStorage-only, no server writes. A newer-than-code blob → stale-app
 * (writes suppressed, "update the app").
 */
export async function hydratePreferences(): Promise<void> {
	hydrating = true;
	_status.set('syncing');
	let res: Response;
	try {
		res = await fetchImpl('/api/preferences');
	} catch {
		hydrating = false;
		_status.set('offline');
		return;
	}
	if (res.status === 401) {
		// Unauthenticated: localStorage-only contract. No server writes.
		serverVersion = 0;
		hydrating = false;
		_status.set('offline');
		return;
	}
	if (!res.ok) {
		hydrating = false;
		_status.set('error');
		return;
	}
	const body = (await res.json()) as { data: unknown; version: number; initialized?: boolean };
	let merged: Preferences;
	try {
		merged = migrateAndMerge(body.data);
	} catch (e) {
		if (e instanceof PreferencesVersionError) {
			// Server holds a newer-shape blob (another device on a newer build).
			// Suppress writes; surface "update the app". Do NOT PATCH a downgrade.
			versionError.set(e);
			serverVersion = 0;
			hydrating = false;
			_status.set('stale-app');
			return;
		}
		throw e;
	}
	serverVersion = body.version;
	// First-login reconcile (codex): a freshly lazy-created server row
	// (`initialized === false`) has never absorbed this user's localStorage prefs
	// (theme/accent/editor toggles saved before server-backing existed). Pushing
	// the server defaults onto the store here would clobber them — and the store's
	// subscribe-to-self would persist that loss back to localStorage. Instead,
	// queue the user's actual deviations-from-defaults as a pending patch so they
	// (a) win in reapplyOntoBase below and (b) flush up to the now-claimed row.
	// Only deltas, so keys the user never touched keep tracking future defaults.
	if (body.initialized === false) {
		const delta = diffFromBase(PREFERENCES_DEFAULTS, get(preferences));
		if (Object.keys(delta).length > 0) {
			accumulate({ set: { schemaVersion: PREFERENCES_CODE_MAX_VERSION, ...delta }, unset: [] });
		}
	}
	// Re-apply un-synced local edits onto the fresh server base.
	preferences.set(reapplyOntoBase(merged));
	hydrating = false;
	if (hasPending()) {
		scheduleFlush();
	} else {
		_status.set('synced');
	}
}

/**
 * Apply a {set, unset} patch: update the local store + cache OPTIMISTICALLY
 * (instant UI), then queue a debounced server PATCH. When not hydrated /
 * anonymous (serverVersion 0) it stays local-only — the next hydrate re-applies
 * the pending edits.
 */
export function applyPreferencePatch(patch: { set?: Record<string, unknown>; unset?: string[] }): void {
	// Stamp schemaVersion so the server `data` blob stays version-stamped. Without
	// this, a server blob that only ever received partial sets would lack
	// schemaVersion, and a later hydrate's migrateAndMerge would run migrations
	// from v0 — overwriting the user's appearance (migration #2 rewrites it).
	const norm: PendingPatch = {
		set: { schemaVersion: PREFERENCES_CODE_MAX_VERSION, ...(patch.set ?? {}) },
		unset: patch.unset ?? []
	};
	// Optimistic local apply (drives UI + CSS vars + localStorage via the store).
	const next = applyUnset(deepMerge(get(preferences), norm.set), norm.unset);
	preferences.set(next);
	// Queue for the server.
	accumulate(norm);
	if (serverVersion !== 0 && !hydrating) scheduleFlush();
}

/** Auth lifecycle. logout → stop pending writes. switch → reset + re-hydrate. */
export async function onAuthChange(kind: 'logout' | 'switch'): Promise<void> {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	pending = { set: {}, unset: [] };
	serverVersion = 0;
	inFlight = false;
	if (kind === 'logout') {
		_status.set('offline');
		return;
	}
	await hydratePreferences();
}

// ── flush machinery ──────────────────────────────────────────────────────────
function scheduleFlush(): void {
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		void flush();
	}, debounceMs);
}

/**
 * Schedule a retry of the requeued patch after a transient failure (network /
 * 5xx / session-expired). Capped exponential backoff so a sustained outage does
 * not hammer the server; a single pending retry at a time. Reset to base on the
 * next successful flush. Without this, a drained patch that hit a transient
 * failure would sit in `pending` forever unless the user happened to make
 * another edit (codex).
 */
function scheduleRetry(): void {
	if (retryTimer) return;
	retryTimer = setTimeout(() => {
		retryTimer = null;
		void flush();
	}, retryBackoffMs);
	retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_MAX_MS);
}

/** 4xx (except auth) means the patch itself is bad — retrying can't fix it. */
function isClientPatchError(status: number): boolean {
	return status === 400 || status === 422;
}

async function flush(): Promise<void> {
	if (inFlight || hydrating || serverVersion === 0 || !hasPending()) return;
	// We are flushing now — cancel any scheduled retry so it doesn't double-fire.
	if (retryTimer) {
		clearTimeout(retryTimer);
		retryTimer = null;
	}
	const patch = drainPending();
	inFlight = true;
	_status.set('syncing');

	let res: Response;
	try {
		res = await fetchImpl('/api/preferences', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ set: patch.set, unset: patch.unset, version: serverVersion })
		});
	} catch {
		// Network failure — requeue and retry with backoff so the edit isn't
		// stranded in localStorage until the user happens to edit again (codex).
		requeue(patch);
		inFlight = false;
		_status.set('offline');
		scheduleRetry();
		return;
	}

	if (res.status === 409) {
		// Stale version — another writer won. Requeue our patch, re-hydrate the
		// base (which re-applies the requeued patch on top), then retry.
		requeue(patch);
		inFlight = false;
		await hydratePreferences();
		if (hasPending()) scheduleFlush();
		return;
	}
	if (!res.ok) {
		if (isClientPatchError(res.status)) {
			// 400 / 422 — the patch is bad; drop it (looping can't fix it) and
			// surface error.
			inFlight = false;
			_status.set('error');
			return;
		}
		// Transient: 5xx server error, 408/429 throttling, or 401 session-expired.
		// The optimistic edit already shows locally; requeue + retry so it reaches
		// the server once the server recovers / the session is refreshed (codex).
		requeue(patch);
		inFlight = false;
		_status.set('offline');
		scheduleRetry();
		return;
	}

	const body = (await res.json()) as { version: number };
	serverVersion = body.version;
	inFlight = false;
	retryBackoffMs = RETRY_BASE_MS; // recovered — reset backoff
	if (hasPending()) {
		scheduleFlush();
	} else {
		_status.set('synced');
	}
}
