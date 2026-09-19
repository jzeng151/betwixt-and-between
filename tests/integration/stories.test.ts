import { beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { stories, entities, worldMaps, mapAnchors } from '../../src/lib/server/db/schema.js';
import * as storyRoute from '../../src/routes/api/stories/+server.js';
import * as storyIdRoute from '../../src/routes/api/stories/[id]/+server.js';
import * as entityRoute from '../../src/routes/api/entities/+server.js';
import * as entityIdRoute from '../../src/routes/api/entities/[id]/+server.js';
import * as aliasesRoute from '../../src/routes/api/entity-aliases/+server.js';
import * as mapRoute from '../../src/routes/api/maps/+server.js';
import * as anchorsRoute from '../../src/routes/api/maps/[id]/anchors/+server.js';
import * as exportRoute from '../../src/routes/api/export/+server.js';

let db: Awaited<ReturnType<typeof createTestDb>>;
let user: Awaited<ReturnType<typeof seedTestUser>>;
let second: string;
beforeEach(async () => {
	db = await createTestDb();
	user = await seedTestUser(db);
	const [story] = await db.insert(stories).values({ userId: user.id, name: 'Second story' }).returning();
	second = story.id;
});
function event(storyId?: string, body?: unknown, params = {}) {
	return { locals: { db, user }, params, url: new URL('http://localhost/api/test'), request: new Request('http://localhost/api/test', { method: 'POST', headers: storyId ? { 'x-story-id': storyId } : {}, body: JSON.stringify(body ?? {}) }) } as any;
}

it('creates the default story, lists only owned stories, and validates creation and renaming', async () => {
	const other = await seedTestUser(db, { email: 'other@example.com' });
	const listed = await (await storyRoute.GET(event())).json();
	expect(listed.map((s: any) => s.id)).toEqual([user.id, second]);
	const created = await (await storyRoute.POST(event(undefined, { name: '  Third  ', userId: other.id }))).json();
	expect(created).toMatchObject({ name: 'Third', userId: user.id });
	await expect(storyIdRoute.PATCH(event(undefined, { name: 'Stolen' }, { id: other.id }))).rejects.toMatchObject({ status: 404 });
	const renamed = await (await storyIdRoute.PATCH(event(undefined, { name: 'New name' }, { id: second }))).json();
	expect(renamed.name).toBe('New name');
	await expect(storyRoute.POST(event(undefined, { name: ' ' }))).rejects.toMatchObject({ status: 400 });
	await expect(storyRoute.POST(event(undefined, { name: 'x'.repeat(101) }))).rejects.toMatchObject({ status: 400 });
	await expect(storyRoute.GET({ locals: { user: null } } as any)).rejects.toMatchObject({ status: 401 });
});

it('isolates reads, writes, deletes and parent/alias links between stories in one account', async () => {
	const first = await (await entityRoute.POST(event(undefined, { type: 'Character', name: 'First' }))).json();
	const next = await (await entityRoute.POST(event(second, { type: 'Character', name: 'Second', storyId: user.id }))).json();
	expect(next.storyId).toBe(second);
	expect((await (await entityRoute.GET(event(second))).json()).map((e: any) => e.id)).toEqual([next.id]);
	expect((await (await entityRoute.GET(event())).json()).map((e: any) => e.id)).toEqual([first.id]);
	await expect(entityIdRoute.PATCH(event(second, { name: 'Overwrite' }, { id: first.id }))).rejects.toMatchObject({ status: 404 });
	await expect(entityIdRoute.DELETE(event(second, undefined, { id: first.id }))).rejects.toMatchObject({ status: 404 });
	await expect(entityRoute.POST(event(second, { type: 'Character', name: 'Child', parentId: first.id }))).rejects.toMatchObject({ status: 400 });
	await expect(aliasesRoute.POST(event(second, { primaryEntityId: next.id, aliasEntityId: first.id }))).rejects.toMatchObject({ status: 400 });
	expect((await db.select().from(entities).where(eq(entities.id, first.id)))[0].name).toBe('First');
});

it('scopes maps and their child records and rejects an unowned or malformed story selector', async () => {
	const [map] = await db.insert(worldMaps).values({ storyId: user.id, name: 'First map' }).returning();
	await db.insert(mapAnchors).values({ worldMapId: map.id, tPosition: -Infinity, stateJsonb: { regions: [] } });
	expect(await (await mapRoute.GET(event(second))).json()).toEqual([]);
	await expect(anchorsRoute.GET(event(second, undefined, { id: map.id }))).rejects.toMatchObject({ status: 404 });
	const other = await seedTestUser(db, { email: 'foreign@example.com' });
	await expect(entityRoute.GET(event(other.id))).rejects.toMatchObject({ status: 404 });
	await expect(entityRoute.GET(event('bad'))).rejects.toMatchObject({ status: 400 });
});

it('exports all owned stories using version 2 without another account or its story data', async () => {
	const foreign = await seedTestUser(db, { email: 'foreign@example.com' });
	await db.insert(entities).values([
		{ storyId: user.id, type: 'Note', name: 'First' },
		{ storyId: second, type: 'Note', name: 'Second' },
		{ storyId: foreign.id, type: 'Note', name: 'Foreign' }
	]);
	const exported = await (await exportRoute.GET(event(second))).json();
	expect(exported.version).toBe(2);
	expect(exported.tables.stories.map((s: any) => s.id).sort()).toEqual([user.id, second].sort());
	expect(exported.tables.entities.map((e: any) => e.name).sort()).toEqual(['First', 'Second']);
});
