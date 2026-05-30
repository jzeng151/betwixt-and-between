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

// 'Artifact', 'Item' added in WorldMap v2 Step 4 (2026-05-16) as placeable
// entity types for map_placements.placeable_id (alongside the pre-existing
// 'Character'). They are full entities (Wiki-pageable, can participate in
// relationships) but ship with minimal surface-specific UI: they reuse
// EntityDetail's default-section editor and appear as Palette chips.
// Richer per-type editors are deferred until use patterns emerge.
//
// 'Door' was cut by the 2026-05-20 whole-app audit (Step 5.5,
// drizzle/0011_data_model_cleanup.sql): no special validators, no special
// data fields, no special rendering — "Artifact with a different label."
// Existing Door rows were converted to Artifact + data.legacySubtype='door'.
// Door mechanics (locked, key_artifact_id, connects_to, portal projection)
// revisit if/when hex-grid + fog-of-war moves from deferred to active.
export const EntityType = [
	'Character',
	'Location',
	'Event',
	'Act',
	'Scene',
	'Note',
	'Artifact',
	'Item'
] as const;
export type EntityType = (typeof EntityType)[number];

// Subset of EntityType allowed in map_placements.placeable_id. Enforced in
// the API layer (assertPlaceableId) and via Vitest invariant tests; same
// pattern as intervals.start_act_id polymorphic FK guards.
export const PlaceableEntityType = ['Character', 'Artifact', 'Item'] as const;
export type PlaceableEntityType = (typeof PlaceableEntityType)[number];

// Slice 3 T1' — grid types accepted by world_maps.grid_type. CHECK constraint
// in drizzle/0018_world_maps_grid.sql restricts to these two values; the
// `text('grid_type', { enum: GridType })` annotation on worldMaps below gives
// Drizzle the same constraint at the TS layer. Matches the EntityType /
// PlaceableEntityType pattern so client + server code import one source of
// truth instead of typing string literals.
export const GridType = ['square', 'hex'] as const;
export type GridType = (typeof GridType)[number];

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
 *   takes_place_at — Event takes_place_at Location
 *   caused_by      — Event/Scene caused_by Event/Scene (effect → cause).
 *                    Conditionally cut at WM3 Slice 5 close once link_chain
 *                    events render as graph edges (audit deliverable #3).
 *   allied_with    — Character allied_with Character (symmetric semantically)
 *   rivals         — Character rivals Character (symmetric semantically)
 *   located_at     — Character located_at Location
 *   note_of        — Note note_of <any> (Wiki-rework Notes-as-sections model,
 *                    2026-05-05). Attaches a Note entity to a parent entity so
 *                    EntityDetail can render it under the parent's NOTES
 *                    section. `from` is always the Note; `to` is the parent.
 *   part_of        — Location part_of Location (WorldMap v2 Step 2,
 *                    2026-05-14). Models the Location hierarchy used by
 *                    drill-down navigation. `from` is the child, `to` is the
 *                    parent. Single-parent in v2: a Location may have at most
 *                    one outgoing `part_of` edge; cycles rejected at write time.
 *                    Both endpoints must be type='Location' (validated in
 *                    assertPartOfEndpoints).
 *   other          — Escape-hatch typed edge. The `label` text column
 *                    carries a free-text name for the relationship.
 *
 * Cut by the 2026-05-20 whole-app audit (Step 5.5,
 * drizzle/0011_data_model_cleanup.sql):
 *   appears_in     — Already write-blocked 2026-04-28 (ADR 0002). Remaining
 *                    legacy rows deleted; the never-shipped backfill is
 *                    closed out.
 *   mentor_of      — Novelist's character-arc shorthand; no read-side
 *                    consumer. Rewritten to other + label='mentor of'.
 *   pov_of         — No read-side consumer today; per-POV simulation is a
 *                    v4-scale slice. Deleted.
 */
export const RelationshipType = [
	'takes_place_at',
	'caused_by',
	'allied_with',
	'rivals',
	'located_at',
	'note_of',
	'part_of',
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
// Position math (docs/adr/0003-premise-4-position-math.md → "The math"):
//   Act i occupies [i, i + 1)
//   Scene k of m within Act i occupies [i + k/m, i + (k+1)/m)
//
// Polymorphism: start_act_id / end_act_id must reference entities of type='Act';
// start_scene_id / end_scene_id must reference entities of type='Scene'. Postgres
// cannot enforce a polymorphic FK constraint cleanly; writeInterval validates at
// write time + the Vitest invariant test asserts type alignment on every row
// (docs/adr/0003-premise-4-position-math.md → "Trade-offs" → polymorphic FKs).
//
// ON DELETE behavior (docs/adr/0003-premise-4-position-math.md → "ON DELETE behavior"):
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
// a deleted Location via ON DELETE SET NULL.
//
// `location_inactive_at` records when SET NULL fired so the UI can surface
// orphan maps for re-linking. NULL on healthy rows; non-NULL after a Location
// referenced by `location_id` was deleted (or the user manually unlinked).
// =============================================================================
// =============================================================================
// world_maps variant columns — WorldMap v2 Step 3 (2026-05-14)
// =============================================================================
//
// A "variant" is a world_map row that depicts a particular Location during a
// scoped story-time window. start_act_id / end_act_id reference Act entities;
// start_scene_id / end_scene_id reference Scene entities. Polymorphic FK
// invariants enforced at the write layer (assertWorldMapVariantBounds) and by
// Vitest invariant tests — same precedent as intervals.start_act_id.
//
// start_position / end_position are derived from the FK refs using the same
// Premise-4 math that intervals + relationships use. They are recomputed on
// write and re-cascaded on Act reorder via recomputeWorldMapVariantsAll
// (M11 design lock).
//
// A row with all four FKs NULL is the "default variant" for its Location:
// it wins variant resolution whenever no temporally-scoped variant covers
// the playhead. The partial-unique world_maps_one_default_per_location
// guarantees at most one default per Location.
//
// Open-ended variants (start non-NULL, end NULL — or vice versa) are not
// supported in v2 — the EXCLUDE WHERE clause requires both positions present.
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
	// Variant temporal bounds (Step 3). All four nullable: NULL means default variant.
	startActId: uuid('start_act_id').references(() => entities.id, { onDelete: 'set null' }),
	startSceneId: uuid('start_scene_id').references(() => entities.id, { onDelete: 'set null' }),
	endActId: uuid('end_act_id').references(() => entities.id, { onDelete: 'set null' }),
	endSceneId: uuid('end_scene_id').references(() => entities.id, { onDelete: 'set null' }),
	startPosition: doublePrecision('start_position'),
	endPosition: doublePrecision('end_position'),
	// Slice 3 T1' — grid columns (drizzle/0018_world_maps_grid.sql).
	// Deferred from Slice 1a per design doc § A3; Slice 3 owns them.
	// CHECK constraints declared below; values:
	//   • gridType: 'square' (default) | 'hex'. Open Question #1
	//     resolved to square as the code default; hex available per
	//     map by setting the column.
	//   • gridCellsX/Y: 32/24 defaults; CHECK bounds 4-128 per
	//     outside-voice B9b (codex #12: 200×200 = 40k cells/anchor
	//     is too generous; 128×128 = 16k is a sensible upper).
	//   • gridScaleUnit/Value: display metadata, not used in projection.
	//   • gridVisible: false for existing rows (two-pass default in
	//     0018 per outside-voice B9a); true for new rows.
	gridType: text('grid_type', { enum: GridType }).notNull().default('square'),
	gridCellsX: integer('grid_cells_x').notNull().default(32),
	gridCellsY: integer('grid_cells_y').notNull().default(24),
	gridScaleUnit: text('grid_scale_unit').notNull().default('m'),
	gridScaleValue: doublePrecision('grid_scale_value').notNull().default(5.0),
	gridVisible: boolean('grid_visible').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('world_maps_location_id_idx').on(table.locationId),
	check(
		'world_maps_grid_type_check',
		sql`${table.gridType} IN ('square', 'hex')`
	),
	check(
		'world_maps_grid_cells_bounds_check',
		sql`${table.gridCellsX} BETWEEN 4 AND 128 AND ${table.gridCellsY} BETWEEN 4 AND 128`
	)
	// EXCLUDE constraint (world_maps_variant_no_overlap), CHECK
	// (world_maps_variant_position_order) and partial-unique
	// (world_maps_one_default_per_location) defined in
	// 0009_world_map_v2_variants_and_part_of.sql — Drizzle's table DSL
	// does not support EXCLUDE, partial UNIQUE indexes, or extensions.
]);

// =============================================================================
// map_placements — WorldMap v2 Step 4 (2026-05-16)
// =============================================================================
//
// First-class placement instances. A placement binds a *placeable entity*
// (Character / Artifact / Item — see PlaceableEntityType) to a Location
// and a fractional point on the map at (x, y) ∈ [0, 1]². Each
// placement also carries its own active window in story-time via the same
// 4-FK + 2-derived-position shape as relationships and world_maps variants.
//
// `location_id` is the durable anchor (M2): even if a variant swaps the map
// image, the placement still resolves at the same fraction-of-image point on
// whichever variant is active at the playhead. `map_id` is a write-time hint
// (where the author drew it) and SET NULL on map delete — the placement
// survives via location resolution.
//
// `placeable_id` is a polymorphic FK to entities(id) constrained to
// PlaceableEntityType at the write layer (assertPlaceableId) + Vitest
// invariant tests + this comment. Postgres cannot CHECK a column's referent
// type cleanly (same precedent as intervals.start_act_id, world_maps.location_id).
//
// ON DELETE behavior (M8):
//   placeable_id → CASCADE  (delete character → all their placements gone)
//   location_id  → SET NULL (orphan placement; UI surfaces it for re-anchor)
//   map_id       → SET NULL (the hint goes; placement still resolves via location)
//   start_act_id / end_act_id     → SET NULL + position recompute (M11)
//   start_scene_id / end_scene_id → SET NULL + position recompute (M11)
//
// Coords (B11): stored as fractions of source-image dimensions in [0, 1].
// Render-time multiplication against current image dimensions means image
// re-export at a different resolution leaves placements at the same relative
// point. Enforced by check `map_placements_xy_unit_range`.
// =============================================================================
export const mapPlacements = pgTable(
	'map_placements',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
		placeableId: uuid('placeable_id')
			.notNull()
			.references(() => entities.id, { onDelete: 'cascade' }),
		locationId: uuid('location_id').references(() => entities.id, { onDelete: 'set null' }),
		mapId: uuid('map_id').references(() => worldMaps.id, { onDelete: 'set null' }),
		x: doublePrecision('x').notNull(),
		y: doublePrecision('y').notNull(),
		startActId: uuid('start_act_id').references(() => entities.id, { onDelete: 'set null' }),
		startSceneId: uuid('start_scene_id').references(() => entities.id, { onDelete: 'set null' }),
		endActId: uuid('end_act_id').references(() => entities.id, { onDelete: 'set null' }),
		endSceneId: uuid('end_scene_id').references(() => entities.id, { onDelete: 'set null' }),
		startPosition: doublePrecision('start_position'),
		endPosition: doublePrecision('end_position'),
		// Free-form per-placement overrides (icon override, label, hint).
		// Kept jsonb to avoid schema churn while step 4 surfaces firm up.
		data: jsonb('data').notNull().default({}).$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('map_placements_location_position_idx').on(
			table.locationId,
			table.startPosition,
			table.endPosition
		),
		index('map_placements_placeable_idx').on(table.placeableId),
		index('map_placements_map_idx').on(table.mapId),
		check(
			'map_placements_xy_unit_range',
			sql`${table.x} >= 0 AND ${table.x} <= 1 AND ${table.y} >= 0 AND ${table.y} <= 1`
		),
		check(
			'map_placements_position_order',
			sql`(${table.startPosition} IS NULL AND ${table.endPosition} IS NULL) OR (${table.startPosition} IS NOT NULL AND ${table.endPosition} IS NOT NULL AND ${table.startPosition} < ${table.endPosition})`
		)
	]
);

// Slice 2 D2 PR-C (T6): map_regions table dropped
// (drizzle/0016_d2_drop_map_regions.sql). Region identity, geometry, and
// location-link now live exclusively in map_anchors.state_jsonb.regions[];
// the baseline anchor (t_position = -Infinity) is canonical. See
// src/lib/server/world-map-v3.ts → readBaselineRegions /
// readBaselineRegionsForUser for the read path, and
// src/lib/server/anchor-region-write-through.ts for the write helpers.

// =============================================================================
// World Map v3 foundation — Slice 1a (2026-05-22)
// =============================================================================
//
// `map_anchors` are author-placed keyframes: at `t_position`, `state_jsonb` is
// the canonical snapshot of the world. `map_events` are typed delta operations
// between anchors. `factions` group regions for ownership/color.
//
// Cross-user scoping (CLAUDE.md invariant): `map_anchors` and `map_events`
// have NO `user_id` column. Every query must scope through
// `world_maps.user_id` via JOIN. A missing JOIN is a cross-user data leak.
// `factions` carries `user_id` directly (no natural parent).
//
// t_position is doublePrecision (float8) to match intervals.startPosition;
// `'-Infinity'::float8` is the initial-anchor sentinel installed by the
// 0012 migration backfill.
//
// `map_events.source_event_id` is a polymorphic FK to entities(id) where the
// target's type must be 'Event'. Enforced at the app layer in writeMapEvent
// + a Vitest invariant test (assertSourceEventIdIsEvent) — same pattern as
// intervals.start_act_id and world_maps.location_id.
//
// `map_anchors` is mutable (user-edited snapshots) — bump_updated_at trigger
// installed by 0012. `map_events` is append-only (delete-then-insert for
// edits) — no `updated_at`, no trigger. `factions` is mutable — trigger
// installed by 0012.
// =============================================================================
export const mapAnchors = pgTable('map_anchors', {
	id: uuid('id').primaryKey().defaultRandom(),
	worldMapId: uuid('world_map_id')
		.notNull()
		.references(() => worldMaps.id, { onDelete: 'cascade' }),
	tPosition: doublePrecision('t_position').notNull(),
	stateJsonb: jsonb('state_jsonb').notNull(),
	// Slice 3 T15 — synthetic-anchor marker
	// (drizzle/0019_map_anchors_is_synthetic.sql). true = server-written
	// by the auto-anchor path in paint_cells POST (outside-voice B7
	// tight rules: K=20 non-undone paint_cells events between user
	// anchors, stroke-boundary aware). false = user-authored anchor.
	// Undo policy (outside-voice A9 + B7): synthetic anchors are NOT
	// dependents in the Slice 2 D3 cascade-undo prompt; projection
	// bypasses them when their snapshot would be invalidated.
	isSynthetic: boolean('is_synthetic').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	uniqueIndex('map_anchors_world_map_id_t_position_uniq').on(table.worldMapId, table.tPosition)
]);

export const mapEvents = pgTable('map_events', {
	id: uuid('id').primaryKey().defaultRandom(),
	worldMapId: uuid('world_map_id')
		.notNull()
		.references(() => worldMaps.id, { onDelete: 'cascade' }),
	tPosition: doublePrecision('t_position').notNull(),
	kind: text('kind').notNull(),
	payloadJsonb: jsonb('payload_jsonb').notNull(),
	sourceEventId: uuid('source_event_id').references(() => entities.id, { onDelete: 'set null' }),
	// Slice 2 D3 (T7): soft-delete marker for undone events. NULL on live
	// rows; non-NULL once undone. Projection + list endpoints filter on
	// `undone_at IS NULL`. Append-only history posture preserved — undone
	// rows are kept for audit, never resurrected (redo creates a fresh row).
	undoneAt: timestamp('undone_at', { withTimezone: true }),
	// Slice 3 T21 — chunked-stroke grouping
	// (drizzle/0020_map_events_command_id.sql). Client generates one
	// UUID per brush stroke; every chunked paint_cells event in that
	// stroke shares the same command_id. Undo handler treats rows
	// sharing a command_id as one logical command (soft-delete all
	// atomically). NULL = standalone event (manual anchors, transfer_
	// region, etc — legacy behavior). Outside-voice B5.
	commandId: uuid('command_id'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('map_events_world_map_id_t_position_idx').on(table.worldMapId, table.tPosition),
	// Partial index over command_id avoids paying index cost on the
	// much-more-common NULL-command_id rows; accelerates the
	// "soft-delete all rows with this command_id" undo path.
	index('map_events_command_id_idx')
		.on(table.worldMapId, table.commandId)
		.where(sql`command_id IS NOT NULL`),
	// Slice 3 /review perf — auto-anchor count hot path. Partial index
	// for (kind='paint_cells' AND undone_at IS NULL); keys on
	// (world_map_id, created_at) for the cutoff range. Declared here
	// so npm run db:push picks it up alongside the migration.
	index('map_events_auto_anchor_idx')
		.on(table.worldMapId, table.createdAt)
		.where(sql`kind = 'paint_cells' AND undone_at IS NULL`)
]);

export const factions = pgTable('factions', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	color: text('color').notNull(),
	styleJsonb: jsonb('style_jsonb'),
	// Slice 2 D1: marks the per-user "Neutral" faction. Server PATCH/DELETE
	// reject mutations on isSystem=true rows. Exactly one per user is
	// enforced by the partial unique index factions_user_one_system
	// (drizzle/0013_factions_is_system.sql) — the schema-level integrity
	// guarantee the design doc § Slice 2 D1 prescribes.
	isSystem: boolean('is_system').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('factions_user_id_idx').on(table.userId),
	// Slice 2 D1: exactly one is_system=true row per user. The partial
	// unique index also lives in drizzle/0013_factions_is_system.sql for
	// migration-built DBs; declared here as well so `npm run db:push`
	// (schema-based DB creation) gets the constraint without depending
	// on the migration journal. codex PR review iter 9: ensureNeutralFaction
	// uses ON CONFLICT DO NOTHING — without the partial unique, concurrent
	// first-writes on a freshly-pushed schema have no conflict to ignore
	// and silently create duplicate Neutral rows.
	uniqueIndex('factions_user_one_system')
		.on(table.userId)
		.where(sql`is_system = true`)
]);

// =============================================================================
// world_map_layer_prefs — World Map v3 Slice 3 T14' (2026-05-27)
// =============================================================================
//
// Per-user-per-map layer visibility. The Slice 3 D6 layered canvas
// (background / grid / terrain / regions / placements / chrome) needs
// per-layer toggle state that survives reloads. window_canvas_state
// doesn't fit (it's keyed on (window_id, entity_id) for graph-window
// node placement — different shape, different lifecycle).
//
// Cross-user invariant (CLAUDE.md + outside-voice codex #15): every
// write MUST scope through world_maps.user_id via JOIN — the user_id
// on this row is "the user authoring the pref," and that user must
// own the world_map. The server-side write helper validates before
// INSERT/UPDATE/DELETE; cross-user writes return 404. Tests in
// tests/integration/auth-isolation-world-map-v3.test.ts.
//
// `visible` is integer 0/1 (not boolean) per CLAUDE.md convention —
// matches window_canvas_state.pinned. Keeps SQL portable.
//
// Layer keys are NOT constrained at the DB layer. The design doc
// enumeration lives in code (src/lib/features/map/layers.ts when it
// lands); stale layer_key rows from renamed/removed layers are
// silently skipped by the reader (lazy GC, matches anchor-jsonb
// policy).
//
// bump_updated_at trigger installed by drizzle/0021. Updated_at
// participation is required because Slice 2 D5 cursor pagination
// orders by updated_at, and CLAUDE.md forbids app-code setting it.
// =============================================================================
export const worldMapLayerPrefs = pgTable(
	'world_map_layer_prefs',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		worldMapId: uuid('world_map_id')
			.notNull()
			.references(() => worldMaps.id, { onDelete: 'cascade' }),
		layerKey: text('layer_key').notNull(),
		visible: integer('visible').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.worldMapId, table.layerKey] }),
		index('world_map_layer_prefs_map_idx').on(table.worldMapId)
	]
);
