// Shape for a seedable story dataset. Author once, load via the API
// loader (`scripts/seed/load.ts`) — both the CLI seed and the future
// T7 (Bulk paste / import UI) will consume this format.
//
// Entity references are by `name` string within a single SeedStory;
// the loader resolves names → server-generated UUIDs after entity
// creation. Names must be unique within the story file.
import type { RelationshipType } from '../../src/lib/server/db/schema.js';

export type TimelineLabel =
  | { mode: 'name-only' }
  | { mode: 'name-and-note' }
  | { mode: 'custom'; field: string };

export interface SeedMetadata {
  title: string;
  author: string;
  /** Stamped onto every created row as `data._seed` so re-runs can
   *  find and delete the prior batch before re-creating. Choose
   *  something stable like `prestige` or `the-sympathizer`. */
  seedKey: string;
  description?: string;
}

export interface SeedAct {
  name: string;
  /** Root-level Act ordering on the global story-time axis. */
  position: number;
  summary?: string;
}

export interface SeedLocation {
  name: string;
  summary?: string;
}

export interface SeedCharacter {
  name: string;
  role?: string;
  affiliation?: string;
  motivation?: string;
  notes?: string;
  /** Hex color (#rrggbb). Mix of palette swatches and custom values
   *  is fine — the loader doesn't validate against the swatch set,
   *  only HEX_COLOR_RE. */
  color?: string;
  timelineLabel?: TimelineLabel;
}

export interface SeedEvent {
  name: string;
  summary?: string;
}

export interface SeedScene {
  name: string;
  /** Parent Act by name. Scenes belong to one Act. */
  parentAct: string;
  summary?: string;
}

export interface SeedRelationship {
  from: string; // entity name
  to: string; // entity name
  /** appears_in is deprecated; use intervals instead. */
  type: Exclude<RelationshipType, 'appears_in'>;
  label?: string;
}

export interface SeedInterval {
  /** Character (or any entity) that appears across these acts. */
  character: string;
  /** Inclusive span — same act on both sides means a single-act presence. */
  fromAct: string;
  toAct: string;
  fromScene?: string;
  toScene?: string;
}

export interface SeedStory {
  metadata: SeedMetadata;
  acts: SeedAct[];
  locations: SeedLocation[];
  characters: SeedCharacter[];
  events: SeedEvent[];
  scenes?: SeedScene[];
  relationships: SeedRelationship[];
  intervals: SeedInterval[];
}
