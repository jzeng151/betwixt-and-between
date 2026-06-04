/**
 * Client-side fetch helpers for the workspace-profiles API (Settings
 * customization Phase 3, T9 — D1 switcher UI).
 *
 * The blob-affecting operations (create, switch) live in preferences-sync.ts
 * because they must drain pending writes + re-hydrate the store. The operations
 * here — list, rename, delete — do NOT touch the active blob/version, so they
 * are plain requests; the UI just refetches the list afterwards.
 */

import type { ProfileSummary } from '../types/preferences.js';
import { ensureOk } from './api-error.js';

export async function fetchProfiles(): Promise<ProfileSummary[]> {
	const res = await ensureOk(await fetch('/api/preferences/profiles'), 'list profiles failed');
	const body = (await res.json()) as { profiles: ProfileSummary[] };
	return body.profiles;
}

export async function renameProfileRequest(
	profileId: string,
	name: string
): Promise<ProfileSummary> {
	const res = await ensureOk(
		await fetch(`/api/preferences/profiles/${encodeURIComponent(profileId)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		}),
		'rename profile failed'
	);
	return (await res.json()) as ProfileSummary;
}

export async function deleteProfileRequest(profileId: string): Promise<void> {
	await ensureOk(
		await fetch(`/api/preferences/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' }),
		'delete profile failed'
	);
}
