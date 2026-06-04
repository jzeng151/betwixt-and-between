import type { EntityType, RelationshipType } from '../server/db/schema.js';
import type { CharacterRole } from '../character-roles.js';
import type { AppId } from '../os/app-ids.js';

export interface Appearance {
	theme: 'dark' | 'light';
	accentColor: string; // hex color
	/**
	 * Settings customization Phase 1 (schema v4) — per-type / per-role color
	 * OVERRIDES. Absent key = use the built-in `--color-*` default; a hex value
	 * overrides it. Partial: only customized types appear. The server validates
	 * keys (EntityType / RelationshipType / CharacterRole) + hex values.
	 */
	entityTypeColors?: Partial<Record<EntityType, string>>;
	relationshipTypeColors?: Partial<Record<RelationshipType, string>>;
	roleColors?: Partial<Record<CharacterRole, string>>;
}

/**
 * Editor preferences. Owned by slice 7 of the wiki rework — the link
 * preview pane below textareas can be globally disabled via Settings.
 */
export interface Editor {
	/** Show resolved [[Name]] chips below textarea drafts in edit mode. */
	linkPreviewEnabled: boolean;
}

/**
 * Graph preferences (Settings customization Phase 2, Item 4). The user's
 * preferred DEFAULT for graph view toggles, applied to every graph window on
 * open (StoryGraph + FocusedGraph). Intentionally a GLOBAL default, not
 * per-window state — the feature is "remember how I like graphs to open".
 */
export interface GraphPrefs {
	/** Hard-filter (hide) out-of-window nodes (true) vs soft-dim them (false). */
	hardFilter: boolean;
	/** Show ghost trails for out-of-scope connections. */
	showGhostTrails: boolean;
}

/**
 * A persisted window geometry default (Settings customization Phase 2, Item 3).
 * Size is persisted for every AppId; position (x,y) ONLY for single-instance
 * apps (POSITION_PERSIST_APP_IDS) — multi-instance apps keep the open-stagger.
 */
export interface WindowDefault {
	width: number;
	height: number;
	x?: number;
	y?: number;
}

/**
 * Window preferences. `defaults` holds "set current as default" geometry keyed
 * by AppId; an absent key falls back to the hardcoded WINDOW_DEFAULTS.
 */
export interface WindowsPrefs {
	defaults: Partial<Record<AppId, WindowDefault>>;
}

/**
 * User preferences shape — the persisted root.
 *
 * Sub-branches add their own sections (appearance, hotkeys, entityDefaults,
 * editor, etc.) by augmenting this interface or extending Preferences in their
 * own type files. The scaffold only owns `schemaVersion`; everything else is
 * additive and version-migrated as needed.
 */
/**
 * Workspace profile summary (Settings customization Phase 3, T9). The list-shape
 * the profiles API returns and the switcher UI renders. Declared here (not in
 * the server module) so the client can import the type without crossing the
 * server-only boundary.
 */
export interface ProfileSummary {
	profileId: string;
	name: string;
	isActive: boolean;
	version: number;
}

export interface Preferences {
	/**
	 * Monotonically-increasing version of the persisted shape. Bump when adding
	 * a section that requires a migration from a prior shape. Read at load time
	 * to decide which migrations to run; refuse-to-run if stored value exceeds
	 * what the running build knows about (downgrade protection).
	 */
	schemaVersion: number;
	appearance: Appearance;
	editor: Editor;
	graph: GraphPrefs;
	windows: WindowsPrefs;
}

/**
 * The current code's max-known version. Bump in lockstep with adding a
 * migration to MIGRATIONS in os/preferences-store.ts.
 */
export const PREFERENCES_CODE_MAX_VERSION: number = 5;

/**
 * Built-in defaults. Sub-branches extend by deep-merge: their defaults compose
 * with this object, never replace it. Frozen so a future caller can't mutate
 * the canonical defaults via reference.
 */
export const PREFERENCES_DEFAULTS: Readonly<Preferences> = Object.freeze({
	schemaVersion: PREFERENCES_CODE_MAX_VERSION,
	appearance: { theme: 'dark' as const, accentColor: '#c8942a' },
	editor: { linkPreviewEnabled: true },
	// Graph toggle defaults — match the prior in-component $state literals
	// (hard filter on, ghost trails off) so existing behavior is unchanged until
	// a user opts in via Settings.
	graph: { hardFilter: true, showGhostTrails: false },
	// No saved window geometry until the user picks "set current as default".
	windows: { defaults: {} }
});
