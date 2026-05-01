import {
	pgTable,
	uuid,
	text,
	integer,
	doublePrecision,
	jsonb,
	timestamp,
	index,
	uniqueIndex,
	check,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const EntityType = ['Character', 'Location', 'Event', 'Act', 'Scene', 'Note'] as const;
export type EntityType = (typeof EntityType)[number];

/**
 * Relationship types and their directional convention (`from [type] to`):
 *   appears_in     — DEPRECATED for new writes (see V1 retirement, 2026-04-28).
 *                    Kept in the enum for legacy reads.
 *   takes_place_at — Event takes_place_at Location
 *   caused_by      — Event/Scene caused_by Event/Scene (effect → cause)
 *   allied_with    — Character allied_with Character (symmetric semantically)
 *   rivals         — Character rivals Character (symmetric semantically)
 *   mentor_of      — Character (mentor) mentor_of Character (mentee)
 *   located_at     — Character located_at Location
 *   pov_of         — Event/Scene pov_of Character (from is from-the-POV-of to).
 *                    Multi-allowed: an event may have multiple POV characters.
 *                    Uniqueness enforced at (from_id, to_id, type) level.
 */
export const RelationshipType = [
	'appears_in',
	'takes_place_at',
	'caused_by',
	'allied_with',
	'rivals',
	'mentor_of',
	'located_at',
	'pov_of'
] as const;
export type RelationshipType = (typeof RelationshipType)[number];

export const entities = pgTable(
	'entities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		type: text('type', { enum: EntityType }).notNull(),
		name: text('name').notNull(),
		// jsonb so app code can pass objects directly; Drizzle's $type<>
		// gives compile-time shape without runtime parse/stringify at the
		// boundary. Replaces text('data') JSON-stringified pattern from
		// the sqlite era.
		data: jsonb('data').notNull().default({}).$type<Record<string, unknown>>(),
		// Hierarchy support: Scenes use parent_id to point at their parent Act.
		// Acts at root level have parent_id = NULL and use `position` for sibling ordering at the type level.
		parentId: uuid('parent_id').references((): AnyPgColumn => entities.id, {
			onDelete: 'cascade'
		}),
		// Sibling ordering integer. For Scenes within an Act: order within parent.
		// For root-level Acts (parent_id IS NULL, type='Act'): act index in the global story-time axis.
		// NULL for non-Act / non-Scene entities or when ordering is irrelevant.
		position: integer('position'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		// updated_at maintained by `bump_updated_at` BEFORE UPDATE trigger
		// (see migration). Application code does NOT set this column on
		// updates — the trigger fires on every UPDATE and rewrites it to
		// now(). Drops the 17 manual `updatedAt: sql\`(unixepoch())\`` calls
		// that lived across handlers + intervals.ts in the sqlite era.
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('entities_created_at_idx').on(table.createdAt),
		index('entities_parent_idx').on(table.parentId),
		index('entities_type_position_idx').on(table.type, table.position)
	]
);

export const relationships = pgTable(
	'relationships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		fromId: uuid('from_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		toId: uuid('to_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		label: text('label'),
		type: text('type', { enum: RelationshipType }).notNull()
	},
	(table) => [
		// Prevent duplicate edges of the same type between the same pair.
		// Allows multi-edges of DIFFERENT types (e.g., A allied_with B AND
		// A rivals B is illogical but allowed; A pov_of X AND A pov_of Y is
		// allowed and meaningful for multi-POV events). Enforced at the
		// schema level so any future write path automatically inherits the
		// constraint. Migrated 2026-04-29 in 0001_relationships_dedup.sql,
		// carries over to the pg baseline migration regenerated in T8a.
		uniqueIndex('relationships_dedup').on(table.fromId, table.toId, table.type)
	]
);

export const canvasPositions = pgTable('canvas_positions', {
	id: uuid('id').primaryKey().defaultRandom(),
	entityId: uuid('entity_id')
		.notNull()
		.unique()
		.references(() => entities.id, { onDelete: 'cascade' }),
	x: integer('x').notNull().default(0),
	y: integer('y').notNull().default(0),
	width: integer('width').notNull().default(160),
	height: integer('height').notNull().default(80)
});

// =============================================================================
// intervals — Phase 1A PR 1 (ported to pg in T8a, 2026-05-01)
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
// start_scene_id / end_scene_id must reference entities of type='Scene'. Postgres
// cannot enforce a polymorphic FK constraint cleanly; writeInterval validates at
// write time + the Vitest invariant test asserts type alignment on every row
// (CONSIDERATIONS.md → /plan-eng-review resolution item 2).
//
// ON DELETE behavior (CONSIDERATIONS.md → "ON DELETE behavior"):
//   entity_id          → CASCADE (delete character → delete their intervals)
//   start_act_id       → CASCADE (delete act → intervals starting in it lose meaning)
//   end_act_id         → CASCADE (delete act → intervals ending in it lose meaning)
//   start_scene_id     → SET NULL + position recompute (in same transaction)
//   end_scene_id       → SET NULL + position recompute (in same transaction)
// =============================================================================

export const intervals = pgTable(
	'intervals',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		startActId: uuid('start_act_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		startSceneId: uuid('start_scene_id').references(() => entities.id, {
			onDelete: 'set null'
		}),
		endActId: uuid('end_act_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		endSceneId: uuid('end_scene_id').references(() => entities.id, { onDelete: 'set null' }),
		// doublePrecision (float8) to match sqlite REAL precision (8-byte
		// IEEE 754 double). Pg's `real` is single-precision (4-byte float)
		// — would lose precision in scene-fraction math (1/3, 2/3 etc.).
		startPosition: doublePrecision('start_position').notNull(),
		endPosition: doublePrecision('end_position').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('intervals_entity_idx').on(table.entityId),
		index('intervals_position_idx').on(table.startPosition, table.endPosition),
		index('intervals_start_scene_idx').on(table.startSceneId),
		index('intervals_end_scene_idx').on(table.endSceneId),
		check('intervals_position_order', sql`${table.startPosition} < ${table.endPosition}`)
	]
);
