/**
 * Shared in-memory test DB factory.
 *
 * The Drizzle schema lives in src/lib/server/db/schema.ts, but Vitest tests
 * don't run drizzle-kit migrations — they create the DB fresh from raw SQL.
 * This helper mirrors what `0000_*.sql` produces so all unit tests use the
 * same fixture.
 *
 * If schema.ts changes, update this file too. Drift is caught by the
 * invariant test — see test/db-invariants/intervals.test.ts.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/server/db/schema.js';

export function createTestDb() {
	const client = new Database(':memory:');
	client.pragma('foreign_keys = ON');
	client.exec(SCHEMA_DDL);
	return drizzle(client, { schema });
}

export const SCHEMA_DDL = `
CREATE TABLE entities (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT,
  position INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (parent_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX entities_created_at_idx ON entities (created_at);
CREATE INDEX entities_parent_idx ON entities (parent_id);
CREATE INDEX entities_type_position_idx ON entities (type, position);

CREATE TABLE relationships (
  id TEXT PRIMARY KEY NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  label TEXT,
  type TEXT NOT NULL,
  FOREIGN KEY (from_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE canvas_positions (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 160,
  height INTEGER NOT NULL DEFAULT 80,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE intervals (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  start_act_id TEXT NOT NULL,
  start_scene_id TEXT,
  end_act_id TEXT NOT NULL,
  end_scene_id TEXT,
  start_position REAL NOT NULL,
  end_position REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (start_act_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (start_scene_id) REFERENCES entities(id) ON DELETE SET NULL,
  FOREIGN KEY (end_act_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (end_scene_id) REFERENCES entities(id) ON DELETE SET NULL,
  CONSTRAINT intervals_position_order CHECK (start_position < end_position)
);
CREATE INDEX intervals_entity_idx ON intervals (entity_id);
CREATE INDEX intervals_position_idx ON intervals (start_position, end_position);
CREATE INDEX intervals_start_scene_idx ON intervals (start_scene_id);
CREATE INDEX intervals_end_scene_idx ON intervals (end_scene_id);
`;

/** Convenience: seed three Acts (positions 0, 1, 2) into a fresh test DB. */
export async function seedActs(db: ReturnType<typeof createTestDb>) {
	const { entities } = await import('../../src/lib/server/db/schema.js');
	const [act0] = await db
		.insert(entities)
		.values({ type: 'Act', name: 'Act 0', position: 0 })
		.returning();
	const [act1] = await db
		.insert(entities)
		.values({ type: 'Act', name: 'Act 1', position: 1 })
		.returning();
	const [act2] = await db
		.insert(entities)
		.values({ type: 'Act', name: 'Act 2', position: 2 })
		.returning();
	return { act0: act0.id, act1: act1.id, act2: act2.id };
}
