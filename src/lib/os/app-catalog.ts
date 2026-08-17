import type { AppId } from './windows-store.js';

/**
 * Per-app metadata shared by the shell (WindowManager titlebar, Taskbar dock,
 * window picker). Pure data — does NOT import the apps' Svelte components,
 * because Desktop and Taskbar would otherwise pull every feature into their
 * bundles transitively.
 *
 * Field meanings:
 *  - `title`       — shown in the window titlebar; also the default dock label
 *                    for dockable apps. Identical for both today.
 *  - `icon`        — compact text mark used in window-picker rows. Required
 *                    for dockable apps; omitted for hoisted child apps.
 *  - `bare`        — when true, the window renders with no padded content
 *                    area (edge-to-edge). Map / graph / story-player.
 *  - `parent`      — non-dockable child apps hoist under this AppId's dock
 *                    group in the taskbar picker (focused-graph under
 *                    story-graph; story-player under timeline).
 *  - `pickerIcon`  — overrides the dock-group icon when the child appears
 *                    as a row in the window picker, so users can tell a
 *                    focused-graph window apart from its parent story-graph.
 */
export type AppMeta = {
	title: string;
	icon?: string;
	bare?: boolean;
	parent?: AppId;
	pickerIcon?: string;
};

export const APP_CATALOG: Record<AppId, AppMeta> = {
	'character-editor': { title: 'Characters', icon: 'CH' },
	'story-graph':      { title: 'Story Graph', icon: 'GR', bare: true },
	'timeline':         { title: 'Timeline', icon: 'TL' },
	'world-map':        { title: 'World Map', icon: 'MP', bare: true },
	'wiki':             { title: 'Wiki', icon: 'WK' },
	'notes':            { title: 'Notes', icon: 'NT' },
	'settings':         { title: 'Settings', icon: 'ST' },
	'entity-detail':    { title: 'Entity' },
	'focused-graph':    { title: 'Focused Graph', bare: true, parent: 'story-graph', pickerIcon: 'FG' },
	'story-player':     { title: 'Story Player', bare: true, parent: 'timeline', pickerIcon: 'SP' }
};

/**
 * Default order of dock-eligible apps. The upcoming dock-customization
 * feature will let users reorder + hide entries via preferences; until
 * then this array is the dock's source of truth for order and inclusion.
 *
 * Child apps with a `parent` field (focused-graph, story-player) and the
 * entity-detail catch-all are intentionally omitted — they're dispatched
 * by entity-routing and window-picker hoisting, not by direct dock click.
 */
export const DOCK_ORDER: AppId[] = [
	'character-editor',
	'story-graph',
	'timeline',
	'world-map',
	'wiki',
	'notes',
	'settings'
];

/** Predicate: render this app's window edge-to-edge (no content padding)? */
export function isBare(appId: AppId): boolean {
	return APP_CATALOG[appId].bare === true;
}
