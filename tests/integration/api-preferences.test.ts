/**
 * Settings customization Phase 1 — T3 /api/preferences handlers.
 *
 * Thin route over the T2 helpers: GET returns the active blob + version
 * (lazy-creating Default), PATCH passes {set,unset,version} through. Asserts
 * the HTTP contract (200/400/409/401); the merge/concurrency depth is covered
 * in user-preferences-server.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { mkUnauthedEvent } from '../helpers/authed-request.js';

const route = await import('../../src/routes/api/preferences/+server.js');

let db: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

function mkEvent(body?: unknown): any {
	return {
		url: new URL('http://localhost/api/preferences'),
		params: {},
		request: { json: async () => body, headers: new Headers() },
		locals: {
			db,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true },
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 't' }
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe('/api/preferences', () => {
	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
	});

	it('GET lazily creates Default and returns {data:{}, version:1, initialized:false, userId}', async () => {
		const body = await readJson(await route.GET(mkEvent()));
		// initialized:false → a fresh row the client never wrote; signals the
		// first-login reconcile path (codex). userId lets the client scope its
		// localStorage cache to the signed-in user (codex P1).
		expect(body).toEqual({ data: {}, version: 1, initialized: false, userId });
	});

	it('GET returns initialized:true after the first PATCH', async () => {
		await route.GET(mkEvent()); // lazy-create v1 (initialized:false)
		await route.PATCH(mkEvent({ set: { appearance: { theme: 'light' } }, version: 1 }));
		const body = await readJson(await route.GET(mkEvent()));
		expect(body.initialized).toBe(true);
	});

	it('PATCH set merges, bumps version, and persists across GET', async () => {
		await route.GET(mkEvent()); // ensure v1
		const patched = await readJson(
			await route.PATCH(mkEvent({ set: { appearance: { theme: 'light' } }, version: 1 }))
		);
		expect(patched.version).toBe(2);
		expect(patched.data).toMatchObject({ appearance: { theme: 'light' } });

		const reread = await readJson(await route.GET(mkEvent()));
		expect(reread.version).toBe(2);
		expect(reread.data).toMatchObject({ appearance: { theme: 'light' } });
	});

	it('PATCH with a missing version → 400', async () => {
		await route.GET(mkEvent());
		await expect(
			route.PATCH(mkEvent({ set: { appearance: { theme: 'light' } } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH with malformed JSON → 400 (not 500)', async () => {
		await route.GET(mkEvent());
		const ev = mkEvent();
		ev.request.json = async () => {
			throw new SyntaxError('Unexpected token');
		};
		await expect(route.PATCH(ev)).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH with a non-object body (null) → 400 (not 500)', async () => {
		await route.GET(mkEvent());
		await expect(route.PATCH(mkEvent(null))).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH with a stale version → 409', async () => {
		await route.GET(mkEvent());
		await route.PATCH(mkEvent({ set: { appearance: { theme: 'light' } }, version: 1 })); // → v2
		await expect(
			route.PATCH(mkEvent({ set: { appearance: { accentColor: '#abcdef' } }, version: 1 }))
		).rejects.toMatchObject({ status: 409 });
	});

	it('PATCH with an invalid color → 400', async () => {
		await route.GET(mkEvent());
		await expect(
			route.PATCH(mkEvent({ set: { appearance: { accentColor: 'nope' } }, version: 1 }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('GET unauthenticated → 401', async () => {
		await expect(route.GET(mkUnauthedEvent(db) as any)).rejects.toMatchObject({ status: 401 });
	});

	it('PATCH unauthenticated → 401', async () => {
		await expect(
			route.PATCH(mkUnauthedEvent(db, { body: { set: {}, version: 1 } }) as any)
		).rejects.toMatchObject({ status: 401 });
	});
});
