/**
 * Unauthenticated requests are rejected at the auth-gate (T8b S6).
 *
 * Every gated handler calls getUserId(event), which throws 401 when
 * event.locals.user is null. This file walks every endpoint group and asserts
 * a 401 surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { mkUnauthedEvent } from '../helpers/authed-request.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

const entitiesRoute = await import('../../src/routes/api/entities/+server.js');
const entityIdRoute = await import('../../src/routes/api/entities/[id]/+server.js');
const relsRoute = await import('../../src/routes/api/relationships/+server.js');
const intervalsRoute = await import('../../src/routes/api/intervals/+server.js');
const canvasPositionsRoute = await import('../../src/routes/api/canvas-positions/+server.js');
const canvasWindowRoute = await import('../../src/routes/api/canvas-positions/window/[windowId]/+server.js');
const aliasesRoute = await import('../../src/routes/api/entity-aliases/+server.js');
const notesRoute = await import('../../src/routes/api/notes/entries/+server.js');
const foldersRoute = await import('../../src/routes/api/notes/folders/+server.js');
const mapsRoute = await import('../../src/routes/api/maps/+server.js');

describe('unauthenticated requests return 401', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('GET /api/entities → 401', async () => {
		await expect(entitiesRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET /api/entities/[id] → 401', async () => {
		await expect(
			entityIdRoute.GET(mkUnauthedEvent(currentDb, { params: { id: 'x' } }) as any)
		).rejects.toMatchObject({ status: 401 });
	});

	it('GET /api/relationships → 401', async () => {
		await expect(relsRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET /api/intervals → 401', async () => {
		await expect(intervalsRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET /api/canvas-positions → 401', async () => {
		await expect(
			canvasPositionsRoute.GET(mkUnauthedEvent(currentDb) as any)
		).rejects.toMatchObject({ status: 401 });
	});

	it('GET /api/canvas-positions/window/[windowId] → 401', async () => {
		await expect(
			canvasWindowRoute.GET(
				mkUnauthedEvent(currentDb, { params: { windowId: 'win-1' } }) as any
			)
		).rejects.toMatchObject({ status: 401 });
	});

	it('GET /api/entity-aliases → 401', async () => {
		await expect(aliasesRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET /api/notes/entries → 401', async () => {
		await expect(notesRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET /api/notes/folders → 401', async () => {
		await expect(foldersRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET /api/maps → 401', async () => {
		await expect(mapsRoute.GET(mkUnauthedEvent(currentDb) as any)).rejects.toMatchObject({
			status: 401
		});
	});
});
