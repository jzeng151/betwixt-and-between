import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

it('moves existing data into the original story without changing IDs or shared profiles', async () => {
	const db = new PGlite({ extensions: { btree_gist } });
	try {
		const dir = resolve('drizzle');
		const migrations = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
		for (const file of migrations.filter(f => f < '0029')) {
			for (const statement of readFileSync(resolve(dir, file), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.exec(statement);
		}
		const owner = '00000000-0000-4000-8000-000000000001';
		const entity = '00000000-0000-4000-8000-000000000002';
		const map = '00000000-0000-4000-8000-000000000003';
		await db.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [owner, 'Writer', 'writer@example.com']);
		await db.query('INSERT INTO entities (id, user_id, type, name) VALUES ($1, $2, $3, $4)', [entity, owner, 'Character', 'Existing character']);
		await db.query('INSERT INTO world_maps (id, user_id, name) VALUES ($1, $2, $3)', [map, owner, 'Existing map']);
		await db.query("INSERT INTO map_anchors (world_map_id, t_position, state_jsonb) VALUES ($1, '-Infinity', '{\"regions\":[]}')", [map]);
		await db.query("INSERT INTO user_preferences (user_id, name) VALUES ($1, 'Shared profile')", [owner]);
		for (const statement of readFileSync(resolve(dir, '0029_story_ownership.sql'), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.exec(statement);
		expect((await db.query('SELECT id, user_id, name FROM stories')).rows).toEqual([{ id: owner, user_id: owner, name: 'My story' }]);
		expect((await db.query('SELECT id, user_id AS story_id, name FROM entities')).rows).toEqual([{ id: entity, story_id: owner, name: 'Existing character' }]);
		expect((await db.query('SELECT id, user_id AS story_id FROM world_maps')).rows).toEqual([{ id: map, story_id: owner }]);
		expect((await db.query('SELECT t_position FROM map_anchors')).rows).toEqual([{ t_position: -Infinity }]);
		expect((await db.query('SELECT user_id, name FROM user_preferences')).rows).toEqual([{ user_id: owner, name: 'Shared profile' }]);
		await db.query('DELETE FROM "user" WHERE id=$1', [owner]);
		for (const table of ['stories', 'entities', 'world_maps', 'map_anchors', 'user_preferences']) expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
	} finally { await db.close(); }
}, 15_000);
