import { beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import * as schema from '../../src/lib/server/db/schema.js';
import { GET } from '../../src/routes/api/export/+server.js';

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { db = await createTestDb(); });

it('exports every saved data table for the authenticated account, including map history and infinity', async () => {
	const users = [];
	for (const name of ['Own', 'Foreign']) {
		const user = await seedTestUser(db, { name, email: `${name}@test.com` });
		users.push(user);
		const [act, character, alias] = await db.insert(schema.entities).values([
			{ storyId: user.id, type: 'Act', name: `${name} act`, position: 0 },
			{ storyId: user.id, type: 'Character', name: `${name} character`, data: { body: '# Story' } },
			{ storyId: user.id, type: 'Character', name: `${name} alias` }
		]).returning();
		await db.insert(schema.relationships).values({ storyId: user.id, fromId: character.id, toId: alias.id, type: 'allied_with' });
		await db.insert(schema.entityAliases).values({ primaryEntityId: character.id, aliasEntityId: alias.id });
		await db.insert(schema.intervals).values({ storyId: user.id, entityId: character.id, startActId: act.id, endActId: act.id, startPosition: 0, endPosition: 1 });
		await db.insert(schema.canvasPositions).values({ storyId: user.id, entityId: character.id });
		await db.insert(schema.windowCanvasState).values({ storyId: user.id, windowId: 'graph', entityId: character.id, x: 12, y: 34 });
		const [map] = await db.insert(schema.worldMaps).values({ storyId: user.id, name: `${name} map`, baseImageUrl: 'https://example.com/map.png' }).returning();
		await db.insert(schema.mapAnchors).values({ worldMapId: map.id, tPosition: -Infinity, stateJsonb: { regions: [] } });
		await db.insert(schema.mapEvents).values({ worldMapId: map.id, tPosition: 0, kind: 'paint_cells', payloadJsonb: { cells: [] }, undoneAt: new Date() });
		await db.insert(schema.mapPlacements).values({ storyId: user.id, mapId: map.id, placeableId: character.id, x: 0.2, y: 0.3 });
		await db.insert(schema.factions).values({ storyId: user.id, name: `${name} faction`, color: '#123456' });
		await db.insert(schema.worldMapLayerPrefs).values({ storyId: user.id, worldMapId: map.id, layerKey: 'terrain', visible: 0 });
		await db.insert(schema.userPreferences).values({ storyId: user.id, name: `${name} profile` });
		await db.insert(schema.appearancePresets).values({ storyId: user.id, name: `${name} preset` });
		await db.insert(schema.session).values({ userId: user.id, token: `${name}-secret`, expiresAt: new Date(Date.now() + 60_000) });
	}
	const response = await GET({ locals: { db, user: users[0] } } as any);
	expect(response.headers.get('Cache-Control')).toBe('private, no-store');
	expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="betwixt-story-.*\.json"$/);
	const text = await response.text();
	const result = JSON.parse(text);
	expect(result).toMatchObject({ format: 'betwixt-story', version: 2 });
	expect(Object.keys(result.tables)).toHaveLength(15);
	for (const [name, rows] of Object.entries(result.tables)) expect(rows, name).toHaveLength(name === 'entities' ? 3 : 1);
	expect(result.tables.mapAnchors[0].tPosition).toBe('-Infinity');
	expect(result.tables.mapEvents[0].undoneAt).toBeTruthy();
	expect(result.tables.worldMaps[0].baseImageUrl).toBe('https://example.com/map.png');
	expect(text).not.toContain('Foreign');
	expect(text).not.toContain(users[1].id);
	expect(text).not.toContain('secret');
	expect(text).not.toContain('@test.com');
});

it('rejects anonymous exports before querying the database', async () => {
	await expect(GET({ locals: { user: null } } as any)).rejects.toMatchObject({ status: 401 });
});

it('rejects oversized exports without silently dropping rows', async () => {
	const user = await seedTestUser(db);
	await db.execute(sql`insert into entities (user_id, type, name) select ${user.id}::uuid, 'Note', 'note' from generate_series(1, 10001)`);
	await expect(GET({ locals: { db, user } } as any)).rejects.toMatchObject({ status: 413 });
});

it('rejects exports beyond the byte limit', async () => {
	const user = await seedTestUser(db);
	await db.insert(schema.entities).values({ storyId: user.id, type: 'Note', name: 'Large', data: { body: 'x'.repeat(17 * 1024 * 1024) } });
	await expect(GET({ locals: { db, user } } as any)).rejects.toMatchObject({ status: 413 });
});
