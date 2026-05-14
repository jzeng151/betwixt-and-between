import {
	pgTable,
	uuid,
	text,
	integer,
	boolean,
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

// ── Auth tables (Better-Auth) ──────────────────────────────────────────────

export const user = pgTable('user', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
	id: uuid('id').primaryKey().defaultRandom(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	token: text('token').notNull().unique(),
	userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
	scope: text('scope'),
	idToken: text('id_token'),
	password: text('password'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
	id: uuid('id').primaryKey().defaultRandom(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ── Application tables ─────────────────────────────────────────────────────

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
 *   note_of        — Note note_of <any> (Wiki-rework Notes-as-sections model,
 *                    2026-05-05). Attaches a Note entity to a parent entity so
 *                    EntityDetail can render it under the parent's NOTES
 *                    section. `from` is always the Note; `to` is the parent.
 */
export const RelationshipType = [
	'appears_in',
	'takes_place_at',
	'caused_by',
	'allied_with',
	'rivals',
	'mentor_of',
	'located_at',
	'pov_of',
	'note_of',
	'other'
] as const;
export type RelationshipType = (typeof RelationshipType)[number];

export const entities = pgTable(
	'entities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
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
		userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
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
	userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
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
		userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
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
		userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
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

// =============================================================================
// world_maps — WorldMap v2 groundwork (2026-05-13)
// =============================================================================
//
// `location_id` is a polymorphic FK to entities(id) where the target's type
// must be 'Location'. Postgres cannot enforce that cleanly (same constraint
// as intervals.start_act_id — see line ~241), so the invariant is upheld by:
//   - write-time validation in /api/world-maps handlers
//   - Vitest invariant test scanning every row
//   - this schema comment
// Nullable: a map can exist before being linked to a Location, and can outlive
// a deleted Location via ON DELETE SET NULL (matches mapRegions.locationId).
//
// `location_inactive_at` records when SET NULL fired so the UI can surface
// orphan maps for re-linking. NULL on healthy rows; non-NULL after a Location
// referenced by `location_id` was deleted (or the user manually unlinked).
// =============================================================================
export const worldMaps = pgTable('world_maps', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	baseImageUrl: text('base_image_url'),
	width: integer('width'),
	height: integer('height'),
	locationId: uuid('location_id').references(() => entities.id, { onDelete: 'set null' }),
	locationInactiveAt: timestamp('location_inactive_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('world_maps_location_id_idx').on(table.locationId)
]);

export const mapRegions = pgTable('map_regions', {
	id: uuid('id').primaryKey().defaultRandom(),
	mapId: uuid('map_id')
		.notNull()
		.references(() => worldMaps.id, { onDelete: 'cascade' }),
	locationId: uuid('location_id')
		.references(() => entities.id, { onDelete: 'set null' }),
	polygon: jsonb('polygon').notNull().$type<number[][]>(),
	color: text('color'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('map_regions_map_id_idx').on(table.mapId),
	index('map_regions_location_id_idx').on(table.locationId)
]);
