// AppId — the set of window-hosting apps. Declaration-only (a const array + a
// derived union), so BOTH the client window store (windows-store.ts) AND the
// server preferences validator (user-preferences.ts) can import it without the
// server pulling in svelte/store or `document`. Settings customization Phase 2,
// Item 3 (window defaults) keys its `windows.defaults` record off this.

export const APP_IDS = [
	'character-editor',
	'world-map',
	'timeline',
	'entity-detail',
	'wiki',
	'story-graph',
	'focused-graph',
	'notes',
	'settings',
	'story-player'
] as const;

export type AppId = (typeof APP_IDS)[number];

/**
 * Apps whose window POSITION (x,y) default is persisted by "set current as
 * default" (A2/F5). Single-instance apps only — multi-instance apps
 * (character-editor, entity-detail, story-graph, focused-graph, notes) keep the
 * `open()` stagger so instances don't stack, so only their SIZE default is
 * persisted, never position.
 */
export const POSITION_PERSIST_APP_IDS = [
	'settings',
	'world-map',
	'timeline',
	'wiki',
	'story-player'
] as const satisfies readonly AppId[];

export function persistsPosition(appId: AppId): boolean {
	return (POSITION_PERSIST_APP_IDS as readonly string[]).includes(appId);
}
