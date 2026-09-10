import { writable } from 'svelte/store';
import { notesStore } from '$lib/stores/notes.js';
import { flushPendingWrites } from '$lib/stores/pending-writes.js';
import { flushPendingPreferences } from '$lib/os/preferences-sync.js';

export const workspaceClosing = writable(false);
export const workspaceReady = writable(false);
export const workspaceSignedOut = writable(false);
let channel: BroadcastChannel;
let release: (() => void) | undefined;
let active = false;
let ready = Promise.resolve();
let attempt: string | undefined;
let controller: AbortController | undefined;
const LOGOUT_STATE_KEY = 'betwixt-logout-state';
const WORKSPACE_PREFIX = 'betwixt-workspace:';
let workspaceId: string;
let preparing: Promise<void> | undefined;

function holdWorkspace() {
	let acquired!: () => void;
	ready = new Promise<void>((resolve) => { acquired = resolve; });
	void navigator.locks.request(workspaceId, async () => {
		if (!active) return;
		workspaceReady.set(true);
		await new Promise<void>((resolve) => { release = resolve; acquired(); });
		release = undefined;
	});
}

function prepare(id: string) {
	attempt = id;
	workspaceClosing.set(true);
	preparing = saveWorkspace(id);
	return preparing;
}

async function saveWorkspace(id: string) {
	await ready;
	// Wait for every category even when one fails, so cancellation cannot expose
	// editing while an older write can still overwrite a new edit.
	const writes = await Promise.allSettled([flushPendingWrites(), notesStore.flushDrafts()]);
	const preferences = await Promise.allSettled([flushPendingPreferences()]);
	await flushPendingWrites();
	for (const result of [...writes, ...preferences]) {
		if (result.status === 'rejected') throw result.reason;
		if (result.value === false) throw new Error("Couldn't save your notes. Retry saving in Notes before signing out.");
	}
	if (active && attempt === id) {
		localStorage.setItem(workspaceId, id);
		release?.();
	}
}

async function resume(id: string) {
	if (attempt !== id) return;
	await preparing?.catch(() => {});
	if (attempt !== id) return;
	attempt = undefined;
	localStorage.removeItem(workspaceId);
	if (!release) holdWorkspace();
	workspaceClosing.set(false);
}

function leave(unconfirmed = false) {
	attempt = undefined;
	workspaceSignedOut.set(true);
	window.location.replace(unconfirmed ? '/auth/login?signOut=unconfirmed' : '/auth/login');
}

// The coordinator can disappear after dispatching revocation, before broadcasting
// its outcome. Read the persisted phase before deciding whether editing can resume.
function recover(id: string) {
	if (attempt !== id) return;
	let phase: string | null;
	try { phase = localStorage.getItem(LOGOUT_STATE_KEY); }
	catch { leave(true); return; }
	if (phase === `${id}:pending`) leave(true);
	else if (phase === `${id}:done`) leave();
	else resume(id);
}

/** Register this mounted workspace, including background tabs. */
export function startWorkspaceSession() {
	if (!navigator.locks || typeof BroadcastChannel === 'undefined') {
		workspaceReady.set(true);
		return () => workspaceReady.set(false);
	}
	active = true;
	workspaceId = `${WORKSPACE_PREFIX}${crypto.randomUUID()}`;
	channel = new BroadcastChannel('betwixt-auth');
	// A document authenticated before logout can mount after its broadcast.
	// Register behind the coordinator and recheck a protected endpoint first.
	void navigator.locks.request('betwixt-logout', { mode: 'shared' }, async () => {
		try {
			const response = await fetch('/api/preferences', { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
			if (!response.ok) { leave(response.status !== 401); return; }
			if (!active) return;
			holdWorkspace();
			await ready;
		} catch { if (active) leave(true); }
	});
	channel.onmessage = async ({ data }) => {
		if (data.type === 'prepare') {
			const saving = prepare(data.id);
			// Releasing the coordinator lock also recovers tabs if its owner closes.
			void navigator.locks.request('betwixt-logout', () => recover(data.id));
			try { await saving; }
			catch (error) {
				if (!active || attempt !== data.id) return;
				channel.postMessage({ type: 'failed', id: data.id, message: error instanceof Error ? error.message : 'Could not save changes' });
			}
		} else if (data.type === 'failed' && data.id === attempt) {
			controller?.abort(new Error(`Another tab could not save its changes. ${data.message}`));
		} else if (data.type === 'cancel') {
			resume(data.id);
		} else if (data.type === 'logout') {
			leave(data.unconfirmed === true);
		}
	};
	return () => {
		active = false;
		workspaceReady.set(false);
		release?.();
		channel.close();
	};
}

/** Revoke only after every registered workspace explicitly confirms its save. */
export async function closeWorkspaces(signOut: (signal: AbortSignal) => Promise<void>): Promise<void> {
	if (!navigator.locks || typeof BroadcastChannel === 'undefined') {
		throw new Error('This browser cannot safely sign out all tabs here. Open the site over HTTPS in an up-to-date browser and try again.');
	}
	await navigator.locks.request('betwixt-logout', { ifAvailable: true }, async (lock) => {
		if (!lock) throw new Error('Sign-out is already running in another tab.');
		const id = crypto.randomUUID();
		const abort = new AbortController();
		controller = abort;
		const timeout = setTimeout(() => abort.abort(new Error('Sign-out timed out. Check your connection and other tabs, then try again.')), 30_000);
		let leaving = false;
		let revoking = false;
		const participants = (await navigator.locks.query()).held?.filter((lock) => lock.name?.startsWith(WORKSPACE_PREFIX)).map((lock) => lock.name!) ?? [];
		try {
			localStorage.setItem(LOGOUT_STATE_KEY, `${id}:preparing`);
			channel.postMessage({ type: 'prepare', id });
			const cancelled = new Promise<never>((_, reject) => {
				abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
			});
			await Promise.race([prepare(id), cancelled]);
			await Promise.all(participants.map((name) => navigator.locks.request(name, { signal: abort.signal }, () => {
				if (localStorage.getItem(name) !== id) throw new Error('A workspace closed before confirming its changes were saved. Sign-out was cancelled.');
			})));
			localStorage.setItem(LOGOUT_STATE_KEY, `${id}:pending`);
			revoking = true;
			await Promise.race([signOut(abort.signal), cancelled]);
			localStorage.setItem(LOGOUT_STATE_KEY, `${id}:done`);
			leaving = true;
			channel.postMessage({ type: 'logout', id });
			leave();
		} catch (error) {
			if (revoking) {
				leaving = true;
				channel.postMessage({ type: 'logout', id, unconfirmed: true });
				leave(true);
				return;
			}
			throw abort.signal.aborted ? abort.signal.reason : error;
		} finally {
			clearTimeout(timeout);
			controller = undefined;
			for (const name of participants) localStorage.removeItem(name);
			if (!leaving) {
				channel.postMessage({ type: 'cancel', id });
				await resume(id);
			}
		}
	});
}
