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
 * default" (A2/F5). SINGLETON dock apps only — every app the dock launches as a
 * single window (id === appId): character-editor (Characters list), notes,
 * settings, world-map, timeline, wiki, story-player. Excluded: story-graph +
 * focused-graph (multi-instance, random id) and entity-detail (one window PER
 * entity, id = `entity-detail-<entityId>`) — persisting position for those would
 * stack instances at one saved spot, so they keep the `open()` stagger and
 * persist SIZE only.
 */
export const POSITION_PERSIST_APP_IDS = [
	'settings',
	'world-map',
	'timeline',
	'wiki',
	'story-player',
	'character-editor',
	'notes'
] as const satisfies readonly AppId[];

export function persistsPosition(appId: AppId): boolean {
	return (POSITION_PERSIST_APP_IDS as readonly string[]).includes(appId);
}
