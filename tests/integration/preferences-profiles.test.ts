/**
 * Settings customization Phase 3 — workspace profiles (T9).
 *
 * The load-bearing invariant is the at-most-one-active guarantee across every
 * mutation (create / activate / delete), backed by the partial unique index.
 * Also covers: create copies the active blob, the delete guards (not-active,
 * not-last), cross-profile PATCH rejection (F2), and user-scoping.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser, type TestDb } from '../helpers/test-db.js';
import {
	getActivePreferences,
	patchPreferences,
	listProfiles,
	createProfile,
	renameProfile,
	deleteProfile,
	activateProfile
} from '../../src/lib/server/user-preferences.js';
import { userPreferences } from '../../src/lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';

async function expectStatus(p: Promise<unknown>, status: number) {
	await expect(p).rejects.toMatchObject({ status });
}

async function activeCount(db: TestDb, storyId: string): Promise<number> {
	const rows = await db
		.select({ profileId: userPreferences.profileId })
		.from(userPreferences)
		.where(and(eq(userPreferences.storyId, storyId), eq(userPreferences.isActive, 1)));
	return rows.length;
}

describe('Phase 3 profiles', () => {
	let db: TestDb;
	let storyId: string;
	beforeEach(async () => {
		db = await createTestDb();
		storyId = (await seedTestUser(db)).id;
	});

	it('listProfiles lazily creates a single Default', async () => {
		const profiles = await listProfiles(db, storyId);
		expect(profiles).toHaveLength(1);
		expect(profiles[0]).toMatchObject({ name: 'Default', isActive: true });
		expect(await activeCount(db, storyId)).toBe(1);
	});

	it('a created profile is marked initialized, not a first-login reconcile target (codex PR #69)', async () => {
		await createProfile(db, storyId, 'Fork');
		// The copy carries the user's real blob, so a later hydrate must treat it as
		// initialized (initialized:false would let the reconcile path clobber it).
		const active = await getActivePreferences(db, storyId);
		expect(active.initialized).toBe(true);
	});

	it('create copies the active blob and activates the new profile', async () => {
		const active = await getActivePreferences(db, storyId);
		await patchPreferences(db, storyId, { set: { appearance: { theme: 'light' } } }, active.version);

		const created = await createProfile(db, storyId, 'Revision');
		expect(created).toMatchObject({ name: 'Revision', isActive: true });

		// Exactly one active, and it's the new profile carrying the copied blob.
		expect(await activeCount(db, storyId)).toBe(1);
		const nowActive = await getActivePreferences(db, storyId);
		expect(nowActive.profileId).toBe(created.profileId);
		expect((nowActive.data.appearance as { theme: string }).theme).toBe('light');

		const profiles = await listProfiles(db, storyId);
		expect(profiles.map((p) => p.name).sort()).toEqual(['Default', 'Revision']);
	});

	it('requires a profileId stamp on writes once multiple profiles exist (codex PR #69)', async () => {
		const a = await getActivePreferences(db, storyId); // single profile
		// One profile → a stampless write is unambiguous, allowed.
		await patchPreferences(db, storyId, { set: { appearance: { theme: 'light' } } }, a.version);

		await createProfile(db, storyId, 'B'); // now two profiles
		const active = await getActivePreferences(db, storyId);
		// Stampless write is now rejected (400) — a stale tab can't blindly write…
		await expectStatus(
			patchPreferences(db, storyId, { set: { appearance: { theme: 'dark' } } }, active.version),
			400
		);
		// …but a stamped write to the active profile still succeeds.
		await patchPreferences(
			db,
			storyId,
			{ set: { appearance: { theme: 'dark' } } },
			active.version,
			active.profileId
		);
	});

	it('edits to the new profile do not bleed into the original', async () => {
		const a = await getActivePreferences(db, storyId);
		await patchPreferences(db, storyId, { set: { appearance: { accentColor: '#aaaaaa' } } }, a.version);
		const defaultId = (await getActivePreferences(db, storyId)).profileId;

		const fork = await createProfile(db, storyId, 'Fork');
		// Edit the fork (now active). With >1 profile the profileId stamp is now
		// required (F2 completeness), so pass it.
		const forkActive = await getActivePreferences(db, storyId);
		await patchPreferences(
			db,
			storyId,
			{ set: { appearance: { accentColor: '#bbbbbb' } } },
			forkActive.version,
			forkActive.profileId
		);

		// Switch back to Default — its accent is the pre-fork value, untouched.
		await activateProfile(db, storyId, defaultId);
		const back = await getActivePreferences(db, storyId);
		expect((back.data.appearance as { accentColor: string }).accentColor).toBe('#aaaaaa');
		expect(back.profileId).toBe(defaultId);
		expect(back.profileId).not.toBe(fork.profileId);
	});

	it('activate keeps exactly one active row', async () => {
		const defaultId = (await getActivePreferences(db, storyId)).profileId;
		const b = await createProfile(db, storyId, 'B'); // B now active
		await activateProfile(db, storyId, defaultId);
		expect(await activeCount(db, storyId)).toBe(1);
		expect((await getActivePreferences(db, storyId)).profileId).toBe(defaultId);
		await activateProfile(db, storyId, b.profileId);
		expect(await activeCount(db, storyId)).toBe(1);
		expect((await getActivePreferences(db, storyId)).profileId).toBe(b.profileId);
	});

	it('activate of a non-existent profile 404s and leaves the active row intact', async () => {
		const before = await getActivePreferences(db, storyId);
		await expectStatus(activateProfile(db, storyId, crypto.randomUUID()), 404);
		expect(await activeCount(db, storyId)).toBe(1);
		expect((await getActivePreferences(db, storyId)).profileId).toBe(before.profileId);
	});

	it('concurrent activates still resolve to exactly one active row', async () => {
		const defaultId = (await getActivePreferences(db, storyId)).profileId;
		const b = await createProfile(db, storyId, 'B');
		const c = await createProfile(db, storyId, 'C');
		await Promise.allSettled([
			activateProfile(db, storyId, defaultId),
			activateProfile(db, storyId, b.profileId),
			activateProfile(db, storyId, c.profileId)
		]);
		expect(await activeCount(db, storyId)).toBe(1);
	});

	it('delete is blocked for the active profile and the last profile', async () => {
		const defaultId = (await getActivePreferences(db, storyId)).profileId;
		// Last + active.
		await expectStatus(deleteProfile(db, storyId, defaultId), 409);

		const b = await createProfile(db, storyId, 'B'); // B active, Default inactive
		// B is active → blocked.
		await expectStatus(deleteProfile(db, storyId, b.profileId), 409);
		// Default is inactive and not last → deletes.
		await deleteProfile(db, storyId, defaultId);
		expect(await listProfiles(db, storyId)).toHaveLength(1);
		expect(await activeCount(db, storyId)).toBe(1);
	});

	it('rename updates the name', async () => {
		const id = (await getActivePreferences(db, storyId)).profileId;
		const renamed = await renameProfile(db, storyId, id, '  Drafting  ');
		expect(renamed.name).toBe('Drafting'); // trimmed
		expect((await listProfiles(db, storyId))[0].name).toBe('Drafting');
	});

	it('rejects empty and oversized names', async () => {
		const id = (await getActivePreferences(db, storyId)).profileId;
		await expectStatus(renameProfile(db, storyId, id, '   '), 400);
		await expectStatus(createProfile(db, storyId, 'x'.repeat(81)), 400);
	});

	it('PATCH against a stale profileId 409s (F2)', async () => {
		const defaultId = (await getActivePreferences(db, storyId)).profileId;
		await createProfile(db, storyId, 'B'); // B now active
		const active = await getActivePreferences(db, storyId);
		// A write authored against the (now inactive) Default profile must not land.
		await expectStatus(
			patchPreferences(
				db,
				storyId,
				{ set: { appearance: { theme: 'light' } } },
				active.version,
				defaultId
			),
			409
		);
	});

	it('profiles are user-scoped: B cannot activate or delete A’s profile', async () => {
		const otherId = (await seedTestUser(db, { email: 'b@t.com' })).id;
		const aProfile = (await getActivePreferences(db, storyId)).profileId;
		await getActivePreferences(db, otherId); // create B's Default
		await expectStatus(activateProfile(db, otherId, aProfile), 404);
		await expectStatus(deleteProfile(db, otherId, aProfile), 404);
		// A's profile is untouched.
		expect(await activeCount(db, storyId)).toBe(1);
	});
});
