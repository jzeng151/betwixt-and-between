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

function holdWorkspace() {
	let acquired!: () => void;
	ready = new Promise<void>((resolve) => { acquired = resolve; });
	void navigator.locks.request('betwixt-workspace', { mode: 'shared' }, async () => {
		if (!active) return;
		workspaceReady.set(true);
		await new Promise<void>((resolve) => { release = resolve; acquired(); });
		release = undefined;
	});
}

async function prepare(id: string) {
	attempt = id;
	workspaceClosing.set(true);
	await ready;
	await flushPendingWrites();
	if (!await notesStore.flushDrafts()) throw new Error("Couldn't save your notes. Retry saving in Notes before signing out.");
	await flushPendingPreferences();
	// A profile-change conflict can discard an old-profile patch during this flush.
	await flushPendingWrites();
	// A cancelled request may finish after editing has resumed. Keep its lock.
	if (attempt === id) release?.();
}

function resume(id: string) {
	if (attempt !== id) return;
	attempt = undefined;
	workspaceClosing.set(false);
	if (!release) holdWorkspace();
}

function leave(unconfirmed = false) {
	attempt = undefined;
	workspaceSignedOut.set(true);
	window.location.replace(unconfirmed ? '/auth/login?signOut=unconfirmed' : '/auth/login');
}

/** Hold a shared lock for this mounted workspace, including background tabs. */
export function startWorkspaceSession() {
	if (!navigator.locks || typeof BroadcastChannel === 'undefined') {
		workspaceReady.set(true);
		return () => workspaceReady.set(false);
	}
	active = true;
	channel = new BroadcastChannel('betwixt-auth');
	holdWorkspace();
	channel.onmessage = async ({ data }) => {
		if (data.type === 'prepare') {
			const saving = prepare(data.id);
			// Releasing the coordinator lock also recovers tabs if its owner closes.
			void navigator.locks.request('betwixt-logout', () => resume(data.id));
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

/** Revoke the session only after every open workspace has saved and released its lock. */
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
		try {
			channel.postMessage({ type: 'prepare', id });
			const cancelled = new Promise<never>((_, reject) => {
				abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
			});
			await Promise.race([prepare(id), cancelled]);
			await navigator.locks.request('betwixt-workspace', { signal: abort.signal }, async () => {
				revoking = true;
				await Promise.race([signOut(abort.signal), cancelled]);
				leaving = true;
				channel.postMessage({ type: 'logout', id });
				leave();
			});
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
			if (!leaving) {
				channel.postMessage({ type: 'cancel', id });
				resume(id);
			}
		}
	});
}
