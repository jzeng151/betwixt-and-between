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
	// A cancelled request may finish after editing has resumed. Keep its lock.
	if (attempt === id) release?.();
}

function resume(id: string) {
	if (attempt !== id) return;
	attempt = undefined;
	workspaceClosing.set(false);
	if (!release) holdWorkspace();
}

function leave() {
	attempt = undefined;
	workspaceSignedOut.set(true);
	window.location.replace('/auth/login');
}

/** Hold a shared lock for this mounted workspace, including background tabs. */
export function startWorkspaceSession() {
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
			leave();
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
export async function closeWorkspaces(signOut: () => Promise<void>): Promise<void> {
	await navigator.locks.request('betwixt-logout', { ifAvailable: true }, async (lock) => {
		if (!lock) throw new Error('Sign-out is already running in another tab.');
		const id = crypto.randomUUID();
		controller = new AbortController();
		const timeout = setTimeout(() => controller?.abort(new Error('Another workspace is not responding. Check your other tabs and try again.')), 30_000);
		let signedOut = false;
		try {
			channel.postMessage({ type: 'prepare', id });
			const cancelled = new Promise<never>((_, reject) => {
				controller!.signal.addEventListener('abort', () => reject(controller!.signal.reason), { once: true });
			});
			await Promise.race([prepare(id), cancelled]);
			await navigator.locks.request('betwixt-workspace', { signal: controller.signal }, async () => {
				clearTimeout(timeout);
				await signOut();
				signedOut = true;
				channel.postMessage({ type: 'logout', id });
				leave();
			});
		} catch (error) {
			throw controller.signal.aborted ? controller.signal.reason : error;
		} finally {
			clearTimeout(timeout);
			controller = undefined;
			if (!signedOut) {
				channel.postMessage({ type: 'cancel', id });
				resume(id);
			}
		}
	});
}
