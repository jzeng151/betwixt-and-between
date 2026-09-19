import { beforeEach, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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

it('replays concurrent owned story creation, including at the limit, without exposing another account', async () => {
	const id = crypto.randomUUID();
	const create = (body: unknown) => storyRoute.POST(event(undefined, body));
	const copies = await Promise.all([create({ id, name: 'Retry' }), create({ id, name: 'Retry' })]);
	for (const copy of copies) expect(await copy.json()).toMatchObject({ id, name: 'Retry', userId: user.id });
	expect(await db.select().from(stories).where(eq(stories.id, id))).toHaveLength(1);
	await expect(create({ id, name: 'Different' })).rejects.toMatchObject({ status: 409 });
	await expect(create({ id: 'bad', name: 'Invalid' })).rejects.toMatchObject({ status: 400 });
	const other = await seedTestUser(db, { email: 'story-replay-other@example.com' });
	await expect(create({ id: other.id, name: 'My story' })).rejects.toMatchObject({ status: 409 });
	expect((await db.select().from(stories).where(eq(stories.id, other.id)))[0].userId).toBe(other.id);
	await db.insert(stories).values(Array.from({ length: 97 }, (_, i) => ({ userId: user.id, name: `Filler ${i}` })));
	expect(await (await create({ id: id.toUpperCase(), name: 'Retry' })).json()).toMatchObject({ id });
	await expect(create({ id: crypto.randomUUID(), name: 'One too many' })).rejects.toMatchObject({ status: 409 });
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


it('provisions the original story on concurrent loads without a signup trigger', async () => {
	await db.execute(sql`DROP TRIGGER user_default_story ON "user"`);
	user = await seedTestUser(db, { email: 'schema-push@example.com' });
	expect(await db.select().from(stories).where(eq(stories.userId, user.id))).toEqual([]);
	await Promise.all([entityRoute.GET(event()), entityRoute.GET(event())]);
	expect(await db.select({ id: stories.id, userId: stories.userId }).from(stories).where(eq(stories.userId, user.id)))
		.toEqual([{ id: user.id, userId: user.id }]);
});

it('isolates appearance, active profiles and saved presets between stories and exports both', async () => {
	const prefs = await import('../../src/routes/api/preferences/+server.js');
	const profiles = await import('../../src/routes/api/preferences/profiles/+server.js');
	const profile = await import('../../src/routes/api/preferences/profiles/[id]/+server.js');
	const activate = await import('../../src/routes/api/preferences/profiles/[id]/activate/+server.js');
	const presets = await import('../../src/routes/api/preferences/presets/+server.js');
	const preset = await import('../../src/routes/api/preferences/presets/[id]/+server.js');
	const first = await (await prefs.GET(event())).json();
	await prefs.PATCH(event(undefined, { version: first.version, profileId: first.profileId, set: { appearance: { theme: 'light', accentColor: '#123456' } } }));
	const secondPrefs = await (await prefs.GET(event(second))).json();
	expect(secondPrefs).toMatchObject({ storyId: second, userId: user.id, data: {}, initialized: false });
	expect(secondPrefs.profileId).not.toBe(first.profileId);
	const copied = await (await profiles.POST(event(undefined, { name: 'Original setup' }))).json();
	const saved = await (await presets.POST(event(undefined, { name: 'Original colors', appearance: { theme: 'light', accentColor: '#123456' } }))).json();
	expect((await (await profiles.GET(event(second))).json()).profiles.map((p: any) => p.name)).toEqual(['Default']);
	expect((await (await presets.GET(event(second))).json()).user).toEqual([]);
	await expect(activate.POST(event(second, undefined, { id: copied.profileId }))).rejects.toMatchObject({ status: 404 });
	await expect(profile.PATCH(event(second, { name: 'Stolen' }, { id: copied.profileId }))).rejects.toMatchObject({ status: 404 });
	await expect(profile.DELETE(event(second, undefined, { id: first.profileId }))).rejects.toMatchObject({ status: 404 });
	await expect(preset.DELETE(event(second, undefined, { id: saved.presetId }))).rejects.toMatchObject({ status: 404 });
	await prefs.PATCH(event(second, { version: secondPrefs.version, profileId: secondPrefs.profileId, set: { appearance: { theme: 'dark', accentColor: '#abcdef' } } }));
	expect((await (await prefs.GET(event())).json()).data.appearance).toEqual({ theme: 'light', accentColor: '#123456' });
	const foreign = await seedTestUser(db, { email: 'appearance-foreign@example.com' });
	await expect(prefs.GET(event(foreign.id))).rejects.toMatchObject({ status: 404 });
	const exported = await (await exportRoute.GET(event())).json();
	expect([...new Set(exported.tables.userPreferences.map((p: any) => p.storyId))].sort()).toEqual([user.id, second].sort());
	expect(exported.tables.appearancePresets).toMatchObject([{ storyId: user.id, presetId: saved.presetId }]);
});
