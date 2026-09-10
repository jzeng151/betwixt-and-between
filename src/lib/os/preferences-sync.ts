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
import { failedWrites } from '../stores/pending-writes.js';
import {
	preferences,
	migrateAndMerge,
	PreferencesVersionError,
	versionError,
	getStoredOwner,
	setStoredOwner
} from './preferences-store.js';
import { deepMerge, applyUnset, isPlainObject, diffFromBase } from '../preferences-merge.js';
import { ensureOk } from './api-error.js';
import {
	PREFERENCES_CODE_MAX_VERSION,
	PREFERENCES_DEFAULTS,
	type Preferences,
	type ProfileSummary
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
// The active profile id the current serverVersion/blob belong to (Phase 3, F2).
// Stamped on every PATCH so a write authored against one profile can't land on
// another after a switch (server returns 409 on mismatch). null = anonymous /
// not hydrated.
let serverProfileId: string | null = null;
let pending: PendingPatch = { set: {}, unset: [] };
let inFlight = false;
// The currently-running flush() promise (null when idle). flushPendingPreferences
// awaits it so a profile switch can't proceed while a save is still in the air —
// otherwise that in-flight PATCH lands after the activate and is dropped by the
// profile-change guard, losing an edit meant for the old profile (codex).
let activeFlush: Promise<void> | null = null;
let hydrating = false;
const hydrations = new Set<Promise<void>>();
// Set true on the first successful (200) hydrate and never reset for the session.
// Distinct from serverVersion (which the post-activate path resets to 0): this
// gates profile switch/create on the INITIAL reconcile having happened (codex).
let hasHydratedOnce = false;
// True while a profile switch/create is mid-flight (activate POST + re-hydrate).
// Suppresses debounced flushes so a pending write can't race the activate and
// land on the wrong profile (F2 mitigation 2).
let switching = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// Transient-failure retry (network down / 5xx / session-expired): the optimistic
// edit is already applied locally; we requeue it and retry with capped backoff so
// it eventually reaches the server without a fresh user edit. Reset on any success.
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryBackoffMs = RETRY_BASE_MS;
// A transiently-failed initial hydrate leaves serverVersion at 0, so later edits
// accumulate but never flush (applyPreferencePatch skips while serverVersion===0).
// Retry the hydrate itself with capped backoff so the session reaches the server
// once the connection recovers, without waiting for a manual reload (codex).
let hydrateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let hydrateBackoffMs = RETRY_BASE_MS;

const _status = writable<SyncStatus>('idle');
export const preferencesSyncStatus: Readable<SyncStatus> = { subscribe: _status.subscribe };

// The signed-in user id (from the last authenticated hydrate), or null when
// anonymous / not yet hydrated. The layout stamps it into the palette cookie so
// the SSR no-flash hook can scope that cookie to the current account and not
// inline a different user's colors on first paint (codex P1, SSR half).
const _userId = writable<string | null>(null);
export const preferencesUserId: Readable<string | null> = { subscribe: _userId.subscribe };

// The active profile id (Phase 3). The switcher UI reads this to mark which
// profile is live and to refetch the list after a switch. null = anonymous /
// not hydrated.
const _profileId = writable<string | null>(null);
export const preferencesProfileId: Readable<string | null> = { subscribe: _profileId.subscribe };

// True once a hydrate has reached a state where the local store is SAFE TO DISPLAY:
// a 200 (owner-scoped / foreign discarded) or a definitive 401 (anonymous — the
// cache is the viewer's). Deliberately stays false through a transient GET failure
// (network / 5xx), because in that window the store may still hold another user's
// global cache and ownership is unknown — the layout keeps the palette gate closed
// until this flips, so a failed hydrate on a shared browser can't flash a foreign
// palette before the retry resolves it (codex).
const _resolved = writable<boolean>(false);
export const preferencesOwnershipResolved: Readable<boolean> = { subscribe: _resolved.subscribe };

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
	if (hydrateRetryTimer) clearTimeout(hydrateRetryTimer);
	hydrateRetryTimer = null;
	hydrateBackoffMs = RETRY_BASE_MS;
	serverVersion = 0;
	serverProfileId = null;
	pending = { set: {}, unset: [] };
	inFlight = false;
	activeFlush = null;
	hydrations.clear();
	hydrating = false;
	hasHydratedOnce = false;
	switching = false;
	_userId.set(null);
	_profileId.set(null);
	_resolved.set(false);
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
		// A set cancels a pending unset of the same path OR an ANCESTOR path. The
		// server applies set-then-unset, so a queued whole-subtree unset (e.g.
		// `appearance.entityTypeColors` from an apply-preset) left beneath a newer
		// descendant set (`...entityTypeColors.Character`) would wipe that edit on
		// flush and lose it. Dropping ancestor unsets keeps the newer edit (codex).
		const paths = leafPaths(patch.set);
		pending.unset = pending.unset.filter(
			(u) => !paths.some((p) => p === u || p.startsWith(`${u}.`))
		);
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
export function hydratePreferences(): Promise<void> {
	const task = hydratePreferencesNow();
	hydrations.add(task);
	void task.then(() => hydrations.delete(task), () => hydrations.delete(task));
	return task;
}

async function hydratePreferencesNow(): Promise<void> {
	hydrating = true;
	_status.set('syncing');
	// We are hydrating now — cancel any scheduled hydrate retry so it can't pile up.
	if (hydrateRetryTimer) {
		clearTimeout(hydrateRetryTimer);
		hydrateRetryTimer = null;
	}
	let res: Response;
	try {
		res = await fetchImpl('/api/preferences');
	} catch {
		// Transient network failure — retry with backoff so offline edits aren't
		// stranded at serverVersion 0 until a manual reload (codex).
		hydrating = false;
		_status.set('offline');
		scheduleHydrateRetry();
		return;
	}
	if (res.status === 401) {
		// Unauthenticated: localStorage-only contract. No server writes. This is a
		// RESOLVED state — the cache is the anonymous viewer's, safe to display.
		serverVersion = 0;
		// Reset hasHydratedOnce: a definitive 401 (e.g. session expired after a
		// prior hydrate) returns us to anonymous, local-only mode. Leaving it true
		// would make the post-switch-limbo guard in applyPreferencePatch
		// (hasHydratedOnce && serverVersion 0) silently drop every local edit,
		// breaking the localStorage-only contract (codex).
		hasHydratedOnce = false;
		_userId.set(null);
		_resolved.set(true);
		hydrating = false;
		_status.set('offline');
		return;
	}
	if (!res.ok) {
		// Transient server error (5xx etc.) — same stranding risk as a network
		// failure; retry the hydrate with backoff (codex).
		hydrating = false;
		_status.set('error');
		scheduleHydrateRetry();
		return;
	}
	const body = (await res.json()) as {
		data: unknown;
		version: number;
		initialized?: boolean;
		userId?: string;
		profileId?: string;
	};
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
	serverProfileId = typeof body.profileId === 'string' ? body.profileId : null;
	_profileId.set(serverProfileId);
	hasHydratedOnce = true; // a real server blob has now reconciled — switch/create are safe
	// A current server blob hydrated cleanly — if a too-new localStorage payload
	// had tripped downgrade protection at boot, clear it now so localStorage
	// write-through resumes and the stale payload stops re-firing every reload
	// (codex). No-op on the happy path (already null).
	versionError.set(null);
	// User-scoped cache (codex P1): the store boots from the single global
	// localStorage key BEFORE the request identifies who is signed in, so on a
	// shared browser the *previous* user's prefs are sitting in the store. Compare
	// the cache's recorded owner (set on a prior hydrate) to the signed-in user
	// the server just told us. A positively-different owner means this cache is
	// someone else's — we must neither reconcile it into this account nor display
	// it. Unknown ids (no userId in the response, e.g. deploy skew) fall back to
	// the prior, un-scoped behavior rather than wrongly discarding.
	const currentUserId = typeof body.userId === 'string' ? body.userId : null;
	_userId.set(currentUserId);
	const storedOwner = getStoredOwner();
	const foreignCache = currentUserId != null && storedOwner != null && storedOwner !== currentUserId;

	// First-login reconcile (codex): a freshly lazy-created server row
	// (`initialized === false`) has never absorbed this user's localStorage prefs
	// (theme/accent/editor toggles saved before server-backing existed). Pushing
	// the server defaults onto the store here would clobber them — and the store's
	// subscribe-to-self would persist that loss back to localStorage. Instead,
	// queue the user's actual deviations-from-defaults as a pending patch so they
	// (a) win in reapplyOntoBase below and (b) flush up to the now-claimed row.
	// Only deltas, so keys the user never touched keep tracking future defaults.
	// NOT for a foreign cache — that would import another user's prefs.
	if (body.initialized === false && !foreignCache) {
		const delta = diffFromBase(PREFERENCES_DEFAULTS, get(preferences));
		// Always queue at least the schemaVersion stamp — even with an empty delta —
		// so the server marks the row initialized (its COALESCE sets
		// initialized_from_client_at on the first write). Otherwise a default-pref
		// new user stays initialized:false forever, and a later local-only change is
		// re-treated as first-login state on the next hydrate (codex). Stamp
		// schemaVersion AFTER spreading delta: a legacy cache can carry an older
		// schemaVersion in the diff, and letting it win would initialize the row
		// below code-max and strand future migrations (codex).
		accumulate({ set: { ...delta, schemaVersion: PREFERENCES_CODE_MAX_VERSION }, unset: [] });
	}

	if (foreignCache) {
		// Discard the other user's local store entirely, INCLUDING any pending edits
		// the new user made before the GET resolved (Settings can render during that
		// window, and a reset/swatch click there was computed against the foreign
		// values). Keeping them would write the previous user's prefs into this
		// account. Drop pending and take the migrated server base only (codex).
		pending = { set: {}, unset: [] };
		preferences.set(merged);
	} else {
		// Re-apply un-synced local edits onto the fresh server base. `editor` prefs
		// are local-only by design (Settings writes them via setPreference, never
		// the sync path), so a server blob that lacks them — or holds stale
		// defaults — must not reset the user's editor toggle and then persist that
		// reset back to localStorage via the store subscription. Preserve the local
		// editor branch across hydrate (codex).
		const localEditor = get(preferences).editor;
		preferences.set({ ...reapplyOntoBase(merged), editor: localEditor });
	}

	// Claim the cache for the signed-in user so subsequent loads on this browser
	// are scoped (a later different user trips `foreignCache` above).
	if (currentUserId != null) setStoredOwner(currentUserId);

	hydrating = false;
	hydrateBackoffMs = RETRY_BASE_MS; // recovered — reset hydrate backoff
	// Ownership resolved (200): store is now owner-scoped / foreign cache
	// discarded → safe to display.
	_resolved.set(true);
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
	// Profile-transition guard: refuse edits while the active profile is in flux.
	//   • switching — a switch/create is mid-flight; serverVersion may still belong
	//     to the PREVIOUS profile, so an edit (esp. an apply-preset whose unset list
	//     is computed from the current store) would be authored against the old
	//     profile and replayed onto the new one by the post-switch hydrate.
	//   • hasHydratedOnce && serverVersion 0 — post-activate hydrate hasn't resolved
	//     (transient failure); the store still holds the previous profile.
	// Either way the edit would break a preset's exact-replacement guarantee on the
	// new profile. Anonymous / pre-first-hydrate (hasHydratedOnce false, not
	// switching) is unaffected and keeps its local-only optimistic edits (codex).
	if (switching || (hasHydratedOnce && serverVersion === 0)) return;
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
	if (serverVersion !== 0 && !hydrating && !switching) scheduleFlush();
}

/** Auth lifecycle. logout → stop pending writes. switch → reset + re-hydrate. */
export async function onAuthChange(kind: 'logout' | 'switch'): Promise<void> {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	if (retryTimer) {
		clearTimeout(retryTimer);
		retryTimer = null;
	}
	retryBackoffMs = RETRY_BASE_MS;
	if (hydrateRetryTimer) {
		clearTimeout(hydrateRetryTimer);
		hydrateRetryTimer = null;
	}
	hydrateBackoffMs = RETRY_BASE_MS;
	pending = { set: {}, unset: [] };
	serverVersion = 0;
	serverProfileId = null;
	hasHydratedOnce = false; // new account must re-hydrate before switch/create
	switching = false;
	inFlight = false;
	// Drop the previous account's in-flight flush handle: its result is already
	// discarded (inFlight reset), and leaving it would make the new account's
	// flushPendingPreferences await an abandoned request that may hang until it
	// completes/times out (codex).
	activeFlush = null;
	_userId.set(null);
	_profileId.set(null);
	// Close the gate until the next hydrate re-resolves ownership for the new
	// account; the switch resets the store to defaults first, so nothing foreign
	// is shown meanwhile.
	_resolved.set(false);
	if (kind === 'logout') {
		// Logout is resolved: the local cache is the just-signed-out user's own
		// (anonymous from here), safe to keep displaying.
		_resolved.set(true);
		_status.set('offline');
		return;
	}
	// Switching accounts: discard the previous user's local store BEFORE hydrating.
	// Otherwise the first-login reconcile would diff the prior account's prefs
	// against defaults and PATCH them into the new account's freshly-created row
	// (cross-user write, codex). Resetting to defaults makes that diff empty; the
	// new user's own row (if initialized) overwrites this on hydrate.
	preferences.set({ ...PREFERENCES_DEFAULTS });
	await hydratePreferences();
}

// ── workspace profiles (Phase 3, T9) ─────────────────────────────────────────

/**
 * Flush any pending edits to the CURRENT profile, then drop whatever didn't
 * make it. Called before a profile switch/create so (a) the current profile
 * keeps the user's edits and (b) nothing pending leaks onto the next profile
 * via reapplyOntoBase after the re-hydrate (F2 mitigation 2). A transient flush
 * failure mid-switch is the only case anything is dropped; the optimistic local
 * copy is replaced by the hydrate either way.
 */
/** Refuse a profile switch/create before the initial hydrate has reconciled
 *  localStorage into the server row (codex). */
function requireHydrated(): void {
	// serverVersion 0 means there is NO resolved current server profile right now —
	// covers pre-initial-hydrate (956) AND post-switch limbo (a failed post-activate
	// hydrate leaves hasHydratedOnce true but serverVersion 0). In either case a
	// switch/create would drain nothing and fork whatever profile is active
	// server-side while the store shows a different one. Require a resolved profile,
	// not just a historical hydrate (codex).
	if (serverVersion === 0) {
		throw new Error('preferences are still loading; try again in a moment');
	}
}

export async function flushPendingPreferences(): Promise<void> {
	while (hydrations.size) await Promise.all(hydrations);
	if (!get(_resolved)) throw new Error('Preferences are still loading; try again.');
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	if (retryTimer) {
		clearTimeout(retryTimer);
		retryTimer = null;
	}
	// Await a save already in flight: flush() early-returns while inFlight, and the
	// in-flight patch is no longer in `pending`, so without this the switch would
	// proceed and that PATCH could land after the activate (dropped by the
	// profile-change guard, losing the edit) (codex).
	if (activeFlush) await activeFlush;
	await flush();
	// If flush hit a transient failure (offline / 5xx / expired session) it
	// requeued the patch and scheduled a retry, so `pending` is non-empty here.
	// Do NOT clear it (that would discard the edit) and do NOT switch (the
	// requeued patch would reapply onto the NEXT profile after re-hydrate).
	// Abort instead: the caller surfaces the error, the edit stays pending for
	// the CURRENT profile, and the scheduled retry delivers it once the server
	// recovers (codex). On a clean flush `pending` is already empty — no-op.
	if (hasPending()) {
		throw new Error('could not save pending preference changes; try again');
	}
}

/**
 * Activate a different profile: drain pending writes to the current profile,
 * POST the activate, then re-hydrate so the store reflects the newly-active
 * profile's blob + version + id. Throws on a failed activate (the caller
 * surfaces it inline + reverts optimistic UI).
 */
export async function switchProfile(profileId: string): Promise<void> {
	// Block until the initial hydrate has run: at serverVersion 0 the client
	// hasn't reconciled localStorage into the server row yet, so a switch/create
	// would operate on an un-reconciled base and the subsequent hydrate could
	// overwrite the user's unsynced local prefs (codex).
	requireHydrated();
	// Drain BEFORE flipping `switching`: flushPendingPreferences's flush() is itself
	// gated by the `switching` guard, so setting it first makes the drain a no-op
	// and silently discards the user's last pending edit (data loss).
	await flushPendingPreferences();
	switching = true;
	try {
		const res = await fetchImpl(`/api/preferences/profiles/${encodeURIComponent(profileId)}/activate`, {
			method: 'POST'
		});
		await ensureOk(res, 'activate profile failed').catch((e) => {
			_status.set('error');
			throw e;
		});
	} finally {
		switching = false;
	}
	markUnhydratedUntilSwitchHydrates();
	await hydratePreferences();
	assertSwitchHydrated();
}

/**
 * After an activate commits server-side, mark the client un-hydrated until the
 * new profile's blob arrives: serverVersion 0 suppresses flushes, so an edit
 * made during a slow or transiently-failed post-activate hydrate is NOT stamped
 * with the OLD profile id and dropped by the profile-change guard. A failed
 * hydrate schedules its own retry, which restores version + profileId (codex).
 */
function markUnhydratedUntilSwitchHydrates(): void {
	serverVersion = 0;
	serverProfileId = null;
	_profileId.set(null);
}

/**
 * After a switch/create activates and we re-hydrate, a still-zero serverVersion
 * means the post-activate hydrate failed (transient / 401) and the store is NOT
 * yet on the new profile. Surface that as an unresolved switch so the caller (the
 * Settings switcher) shows an error instead of silently succeeding — at which
 * point edits would be no-ops (see applyPreferencePatch's limbo guard) with no
 * feedback. The scheduled hydrate retry will re-sync the new profile (codex).
 */
function assertSwitchHydrated(): void {
	if (serverVersion === 0) {
		throw new Error('switched profile but could not load it; check your connection and retry');
	}
}

/**
 * Create a new profile (server copies the active blob, then activates it) and
 * re-hydrate so the store tracks the new active profile. Drains pending first
 * so the copied blob includes the user's latest edits, not a stale server base.
 * Returns the created profile summary.
 */
export async function createProfile(name: string): Promise<ProfileSummary> {
	// See switchProfile: refuse before the initial hydrate so the copy isn't taken
	// from an un-reconciled server Default and local prefs aren't lost (codex).
	requireHydrated();
	// Drain BEFORE flipping `switching` (see switchProfile) so the copied blob
	// includes the user's latest edits and nothing pending is silently dropped.
	await flushPendingPreferences();
	switching = true;
	let created: ProfileSummary;
	try {
		const res = await fetchImpl('/api/preferences/profiles', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		await ensureOk(res, 'create profile failed').catch((e) => {
			_status.set('error');
			throw e;
		});
		created = (await res.json()) as ProfileSummary;
	} finally {
		switching = false;
	}
	markUnhydratedUntilSwitchHydrates();
	await hydratePreferences();
	assertSwitchHydrated();
	return created;
}

// ── flush machinery ──────────────────────────────────────────────────────────

/** Launch a fire-and-forget flush, tracking its promise in `activeFlush` so
 *  flushPendingPreferences can await an in-flight save. */
function launchFlush(): void {
	activeFlush = flush().finally(() => {
		activeFlush = null;
	});
}

function scheduleFlush(): void {
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		launchFlush();
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
		launchFlush();
	}, retryBackoffMs);
	retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_MAX_MS);
}

/** 4xx (except auth) means the patch itself is bad — retrying can't fix it. */
function isClientPatchError(status: number): boolean {
	return status === 400 || status === 422;
}

/**
 * Retry a transiently-failed hydrate (network down / 5xx) with capped backoff.
 * Single pending retry; cleared + reset on the next hydrate. Without this, a
 * failed initial GET strands the session at serverVersion 0 and later edits
 * never reach the server until a manual reload (codex).
 */
function scheduleHydrateRetry(): void {
	if (hydrateRetryTimer) return;
	hydrateRetryTimer = setTimeout(() => {
		hydrateRetryTimer = null;
		void hydratePreferences();
	}, hydrateBackoffMs);
	hydrateBackoffMs = Math.min(hydrateBackoffMs * 2, RETRY_MAX_MS);
}

async function flush(): Promise<void> {
	if (inFlight || hydrating || switching || serverVersion === 0 || !hasPending()) return;
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
			body: JSON.stringify({
				set: patch.set,
				unset: patch.unset,
				version: serverVersion,
				// F2: stamp the profile this write was authored against. If the active
				// profile changed server-side, the PATCH 409s instead of landing on
				// the new profile. null (anonymous) is omitted by JSON.stringify.
				profileId: serverProfileId ?? undefined
			})
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
		// Two distinct 409s share this status (both are SvelteKit error() bodies):
		//   • profile-change — the active profile changed under us (another tab or
		//     an in-flight switch). This patch was authored against the OLD profile;
		//     requeuing + re-stamping it would land the edit on the NEW profile,
		//     defeating the F2 guard. DROP it and re-hydrate the new base (codex).
		//   • version-stale — another writer bumped the version on the SAME profile.
		//     Requeue + re-hydrate so the retry re-applies onto the fresh base.
		let profileChanged = false;
		try {
			const b = (await res.json()) as { message?: unknown };
			profileChanged =
				typeof b?.message === 'string' && b.message.includes('active profile changed');
		} catch {
			// Non-JSON 409 body — treat as version-stale (the safe, requeue path).
		}
		// Do NOT schedule a flush here either way: re-flushing while serverVersion is
		// the SAME stale value that just 409'd would loop. hydratePreferences' tail
		// schedules the flush against the fresh version (or a hydrate retry).
		if (profileChanged) {
			failedWrites.update((errors) => [...errors, 'Some appearance changes could not be saved because another tab switched profiles.']);
			// Everything still queued in `pending` was also authored against the OLD
			// profile (this tab hasn't switched), so re-applying it onto the new
			// active profile after hydrate would leak old-profile edits across. Drop
			// the whole queue, not just the drained patch (codex).
			pending = { set: {}, unset: [] };
			// Mark unhydrated before the rehydrate below: if it fails transiently,
			// serverVersion stays 0 so the limbo guard refuses edits, rather than
			// letting them stamp the stale profile id and get dropped (codex). The
			// switch/create paths do the same; this makes all three rehydrates uniform.
			markUnhydratedUntilSwitchHydrates();
		} else {
			requeue(patch);
		}
		inFlight = false;
		await hydratePreferences();
		return;
	}
	if (!res.ok) {
		if (isClientPatchError(res.status)) {
			// Preserve rejected edits for correction or an explicit retry; do not
			// retry automatically. Sign-out/profile changes must see the unsaved patch.
			requeue(patch);
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
