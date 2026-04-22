import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
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
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [index('entities_created_at_idx').on(table.createdAt)]
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
