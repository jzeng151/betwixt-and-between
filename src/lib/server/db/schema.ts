import {
	integer,
	real,
	sqliteTable,
	text,
	index,
	check,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const EntityType = ['Character', 'Location', 'Event', 'Act', 'Scene', 'Note'] as const;
export type EntityType = (typeof EntityType)[number];

export const RelationshipType = [
	'appears_in',
	'takes_place_at',
	'caused_by',
	'allied_with',
	'rivals',
	'mentor_of',
	'located_at'
] as const;
export type RelationshipType = (typeof RelationshipType)[number];

export const entities = sqliteTable(
	'entities',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		type: text('type', { enum: EntityType }).notNull(),
		name: text('name').notNull(),
		data: text('data').notNull().default('{}'),
		// Hierarchy support: Scenes use parent_id to point at their parent Act.
		// Acts at root level have parent_id = NULL and use `position` for sibling ordering at the type level.
		parentId: text('parent_id').references((): AnySQLiteColumn => entities.id, {
			onDelete: 'cascade'
		}),
		// Sibling ordering integer. For Scenes within an Act: order within parent.
		// For root-level Acts (parent_id IS NULL, type='Act'): act index in the global story-time axis.
		// NULL for non-Act / non-Scene entities or when ordering is irrelevant.
		position: integer('position'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [
		index('entities_created_at_idx').on(table.createdAt),
		index('entities_parent_idx').on(table.parentId),
		index('entities_type_position_idx').on(table.type, table.position)
	]
);

export const relationships = sqliteTable('relationships', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	fromId: text('from_id')
		.notNull()
		.references(() => entities.id, { onDelete: 'cascade' }),
	toId: text('to_id')
		.notNull()
		.references(() => entities.id, { onDelete: 'cascade' }),
	label: text('label'),
	type: text('type', { enum: RelationshipType }).notNull()
});

export const canvasPositions = sqliteTable('canvas_positions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	entityId: text('entity_id')
		.notNull()
		.unique()
		.references(() => entities.id, { onDelete: 'cascade' }),
	x: integer('x').notNull().default(0),
	y: integer('y').notNull().default(0),
	width: integer('width').notNull().default(160),
	height: integer('height').notNull().default(80)
});

// =============================================================================
// intervals — Phase 1A PR 1
// =============================================================================
//
// Hybrid storage: FK references to acts/scenes (for referential integrity AND
// scene-anchored lookups) plus computed start_position / end_position REAL
// columns (for fast range queries on the global story-time axis).
//
// Half-open convention: [start_position, end_position). start inclusive,
// end exclusive. CHECK enforces start < end (strict).
//
// Position math (CONSIDERATIONS.md → "Premise 4"):
//   Act i occupies [i, i + 1)
//   Scene k of m within Act i occupies [i + k/m, i + (k+1)/m)
//
// Polymorphism: start_act_id / end_act_id must reference entities of type='Act';
// start_scene_id / end_scene_id must reference entities of type='Scene'. SQLite
// cannot enforce; writeInterval validates at write time + the Vitest invariant
// test asserts type alignment on every row (CONSIDERATIONS.md → /plan-eng-review
// resolution item 2).
//
// ON DELETE behavior (CONSIDERATIONS.md → "ON DELETE behavior"):
//   entity_id          → CASCADE (delete character → delete their intervals)
//   start_act_id       → CASCADE (delete act → intervals starting in it lose meaning)
//   end_act_id         → CASCADE (delete act → intervals ending in it lose meaning)
//   start_scene_id     → SET NULL + position recompute (in same transaction)
//   end_scene_id       → SET NULL + position recompute (in same transaction)
// =============================================================================

export const intervals = sqliteTable(
	'intervals',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		entityId: text('entity_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		startActId: text('start_act_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		startSceneId: text('start_scene_id').references(() => entities.id, {
			onDelete: 'set null'
		}),
		endActId: text('end_act_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		endSceneId: text('end_scene_id').references(() => entities.id, { onDelete: 'set null' }),
		startPosition: real('start_position').notNull(),
		endPosition: real('end_position').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [
		index('intervals_entity_idx').on(table.entityId),
		index('intervals_position_idx').on(table.startPosition, table.endPosition),
		index('intervals_start_scene_idx').on(table.startSceneId),
		index('intervals_end_scene_idx').on(table.endSceneId),
		check('intervals_position_order', sql`${table.startPosition} < ${table.endPosition}`)
	]
);
