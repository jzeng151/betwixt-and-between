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
	primaryKey,
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
		type: text('type', { enum: RelationshipType }).notNull(),
		// Temporal bounds — spotlight integration (Phase 1B Lane A, 2026-05-02).
		// All four FK columns are nullable: NULL means the relationship is
		// timeless. When non-null, start_act_id/end_act_id must reference Act
		// entities; scene FKs must reference Scene entities. Validated at write
		// time by resolveRelationshipBounds (intervals.ts).
		//
		// Uniqueness is enforced by two partial indexes in the migration (Drizzle
		// does not support partial indexes natively):
		//   relationships_timeless_dedup  — (from, to, type) WHERE start_position IS NULL
		//   relationships_temporal_dedup  — (from, to, type, start_position) WHERE start_position IS NOT NULL
		startActId: uuid('start_act_id').references(() => entities.id, { onDelete: 'set null' }),
		startSceneId: uuid('start_scene_id').references(() => entities.id, { onDelete: 'set null' }),
		endActId: uuid('end_act_id').references(() => entities.id, { onDelete: 'set null' }),
		endSceneId: uuid('end_scene_id').references(() => entities.id, { onDelete: 'set null' }),
		startPosition: doublePrecision('start_position'),
		endPosition: doublePrecision('end_position'),
		revealedAtPosition: doublePrecision('revealed_at_position')
	},
	(table) => [
		index('relationships_position_idx').on(table.startPosition, table.endPosition)
		// NOTE: the timeless/temporal dedup partial indexes are defined in
		// 0002_spotlight_temporal.sql because Drizzle does not support partial
		// indexes in the table DSL.
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
// window_canvas_state — Phase 1B Lane A (2026-05-01)
// =============================================================================
//
// Per-window canvas + pin state. Composite PK on (window_id, entity_id) so the
// same entity can appear at different positions in different windows (e.g.
// StoryGraph vs FocusedGraph for a focal-set view). `canvas_positions` stays
// as the seed/fallback layer; first move/layout in a window writes a row here.
//
// `pinned` is integer 0/1 (NOT boolean) per the locked spec — keeps SQL
// portable with the original sqlite shape and avoids casting in client code.
// No created_at / updated_at columns: high-write churn from canvas drags would
// generate trigger noise without ever being read.
// =============================================================================

export const windowCanvasState = pgTable(
	'window_canvas_state',
	{
		windowId: text('window_id').notNull(),
		entityId: uuid('entity_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		x: integer('x').notNull(),
		y: integer('y').notNull(),
		width: integer('width').notNull().default(160),
		height: integer('height').notNull().default(80),
		pinned: integer('pinned').notNull().default(0)
	},
	(table) => [
		primaryKey({ columns: [table.windowId, table.entityId] }),
		index('window_canvas_state_window_idx').on(table.windowId)
	]
);

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

// =============================================================================
// entity_aliases — Phase 1B Lane A (2026-05-02)
// =============================================================================
//
// Maps an entity to an alias entity (e.g., a character's pen name or a
// location's alternate name). The alias is a full entity in its own right;
// this table records the relationship between primary and alias identities.
//
// `revealed_at_position` is nullable: NULL means the alias is always known;
// non-null means it is revealed only at or after that story-time position.
//
// Constraints:
//   entity_aliases_unique   — (primary, alias) pair is unique
//   entity_aliases_no_self  — a row cannot point an entity at itself
// =============================================================================

export const entityAliases = pgTable('entity_aliases', {
	id: uuid('id').primaryKey().defaultRandom(),
	primaryEntityId: uuid('primary_entity_id')
		.notNull()
		.references(() => entities.id, { onDelete: 'cascade' }),
	aliasEntityId: uuid('alias_entity_id')
		.notNull()
		.references(() => entities.id, { onDelete: 'cascade' }),
	revealedAtPosition: doublePrecision('revealed_at_position'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
