/**
 * wiki-nav context — in-window navigation contract for the Wiki app.
 *
 * The Wiki.svelte content pane mounts EntityDetail inline. Without this
 * context, any chip click inside that subtree (relationship chips,
 * resolved [[Name]] hyperlinks, etc.) would call openEntity() and spawn
 * a separate entity-detail window. With the context provided, those
 * clicks call navigate(id) instead, which mutates Wiki.svelte's
 * selectedId so the content pane swaps to the linked entity in-window —
 * the Wikipedia-style flow users expect inside the wiki app.
 *
 * IMPORTANT — ambient hijack contract
 * -----------------------------------
 * EntityLink (and any chip surface that consumes WIKI_NAV) hijacks
 * click navigation when rendered ANYWHERE inside a component subtree
 * that calls setContext(WIKI_NAV, ...). This is intentional for the
 * Wiki app today: every chip in EntityDetail / CharacterEditorBody /
 * LocationEditor / WikiLinkText / NotesSection navigates in-window
 * without per-callsite ceremony.
 *
 * Future surfaces embedded inside the Wiki tree (e.g. a Timeline
 * detail-pane, a Story Graph hover-card) will inherit the hijack —
 * verify that's the desired behavior before adding such surfaces.
 * To opt out per-callsite, switch the chip to an explicit `onNavigate?`
 * prop pattern instead of (or alongside) the context lookup.
 *
 * Svelte 5 context follows the component tree, not the DOM. A popout
 * window opened via windowStore.openForEntity mounts EntityDetail
 * under WindowManager — outside the Wiki subtree — so getContext
 * returns undefined there and consumers fall back to openEntity.
 */

export const WIKI_NAV = Symbol('wiki-nav');

export interface WikiNavContext {
	/** Replace the current Wiki content area's entity. Caller is
	 *  responsible for any side effects (commit-before-navigate, etc.) —
	 *  this method just mutates the underlying state. */
	navigate: (entityId: string) => void;
}
