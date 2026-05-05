<!--
  Wiki — alphabetical entity browser (Phase 1 wiki-rework, slice 1).

  The sidebar lists every entity (except Notes — Lock 2 in design specs)
  grouped by type with faint dividers. Picking a sidebar entry mounts
  EntityDetail in the content area. Sidebar dim from scope-store and
  cross-entity hyperlinks land in later slices of the same branch.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { intervals as intervalsStore } from '$lib/stores/intervals.js';
	import { relationships } from '$lib/stores/relationships.js';
	import { playhead, intervalContainsT } from '$lib/stores/playhead.js';
	import { windowStore } from '$lib/stores/windows.js';
	import { timelineFilter } from '$lib/stores/timelineFilter.js';
	import type { EntityType } from '$lib/server/db/schema.js';
	import EntityDetail from '$lib/components/EntityDetail.svelte';
	import ContextMenu from '$lib/components/ContextMenu.svelte';

	interface Props {
		entityId: string | null;
	}
	let { entityId }: Props = $props();

	// Note entities are deliberately excluded from the sidebar (design
	// specs Lock 2 — Notes are sections of their parent entity, not
	// navigable list items). Type order matches the design ASCII.
	const SIDEBAR_TYPES: EntityType[] = ['Character', 'Location', 'Event', 'Scene', 'Act'];
	const TYPE_LABEL: Record<EntityType, string> = {
		Character: 'Characters',
		Location: 'Locations',
		Event: 'Events',
		Scene: 'Scenes',
		Act: 'Acts',
		Note: 'Notes'
	};

	let selectedId = $state<string | null>(null);
	$effect(() => {
		if (entityId) selectedId = entityId;
	});

	let searchQuery = $state('');
	let activeTypes = $state<Set<EntityType>>(new Set(SIDEBAR_TYPES));

	function toggleType(t: EntityType) {
		const next = new Set(activeTypes);
		if (next.has(t)) next.delete(t);
		else next.add(t);
		activeTypes = next;
	}

	const grouped = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		const out: { type: EntityType; entries: typeof $entities }[] = [];
		for (const t of SIDEBAR_TYPES) {
			if (!activeTypes.has(t)) continue;
			const entries = $entities
				.filter((e) => e.type === t)
				.filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
				.sort((a, b) => a.name.localeCompare(b.name));
			if (entries.length > 0) out.push({ type: t, entries });
		}
		return out;
	});

	const totalSidebarEntities = $derived(
		$entities.filter((e) => SIDEBAR_TYPES.includes(e.type as EntityType)).length
	);

	// ── Context menu (right-click on a sidebar entry) ──────────────────
	let contextMenu = $state<{ entityId: string; x: number; y: number } | null>(null);

	function openContextMenu(e: MouseEvent, entityId: string) {
		e.preventDefault();
		contextMenu = { entityId, x: e.clientX, y: e.clientY };
	}

	const contextItems = $derived(
		contextMenu
			? [
					{
						label: 'Open focused graph',
						icon: '◎',
						onSelect: () => {
							if (!contextMenu) return;
							windowStore.openFocusedGraph([contextMenu.entityId]);
						}
					},
					{
						label: 'Open focused timeline',
						icon: '⟶',
						onSelect: () => {
							if (!contextMenu) return;
							timelineFilter.focus(contextMenu.entityId);
							windowStore.open('timeline');
						}
					}
				]
			: []
	);

	// ── Sidebar dim from playhead/scope ────────────────────────────────
	// An entry is "out of scope" at T iff EITHER it has direct intervals
	// and none of them contain T, OR it has no direct intervals but links
	// to at least one entity that has intervals, and none of those linked
	// entities are active at T. Entries with no time-bound signal stay
	// full-opacity (matches the WorldMap dim semantics — design specs
	// Lock 2 — "dim when scope info exists; do nothing otherwise").
	const outOfScopeIds = $derived.by(() => {
		const out = new Set<string>();
		if ($playhead == null) return out;
		const t = $playhead;

		const ivsByEntity = new Map<string, typeof $intervalsStore>();
		for (const iv of $intervalsStore) {
			const list = ivsByEntity.get(iv.entityId) ?? [];
			list.push(iv);
			ivsByEntity.set(iv.entityId, list);
		}
		function entityActiveAtT(eid: string): boolean {
			const ivs = ivsByEntity.get(eid);
			if (!ivs || ivs.length === 0) return false;
			return ivs.some((iv) => intervalContainsT(iv.startPosition, iv.endPosition, t));
		}

		for (const e of $entities) {
			if (!SIDEBAR_TYPES.includes(e.type as EntityType)) continue;
			const ownIvs = ivsByEntity.get(e.id);
			if (ownIvs && ownIvs.length > 0) {
				if (!entityActiveAtT(e.id)) out.add(e.id);
				continue;
			}
			// No direct intervals — fall back to linked-entity inheritance.
			const linkedIds = $relationships
				.filter((r) => r.fromId === e.id || r.toId === e.id)
				.map((r) => (r.fromId === e.id ? r.toId : r.fromId));
			const ivLinks = linkedIds.filter((id) => (ivsByEntity.get(id)?.length ?? 0) > 0);
			if (ivLinks.length === 0) continue; // no time-bound signal → not dimmed
			if (!ivLinks.some(entityActiveAtT)) out.add(e.id);
		}
		return out;
	});
</script>

{#if totalSidebarEntities === 0}
	<div class="empty-state">
		<p>Your wiki is empty. Create a Character or Location to begin.</p>
	</div>
{:else}
	<div class="wiki-layout">
		<aside class="wiki-sidebar">
			<div class="sidebar-toolbar">
				<input
					class="search-input"
					type="search"
					placeholder="Search…"
					aria-label="Search wiki"
					bind:value={searchQuery}
				/>
			</div>

			<div class="sidebar-list">
				{#each grouped as group}
					<div class="type-group">
						<div class="type-divider">
							<span class="type-divider-label">{TYPE_LABEL[group.type]}</span>
						</div>
						{#each group.entries as entry}
							<button
								type="button"
								class="entry"
								class:active={entry.id === selectedId}
								class:out-of-scope={outOfScopeIds.has(entry.id)}
								onclick={() => (selectedId = entry.id)}
								oncontextmenu={(e) => openContextMenu(e, entry.id)}
							>
								{entry.name}
							</button>
						{/each}
					</div>
				{/each}
				{#if grouped.length === 0}
					<p class="sidebar-empty">No matches.</p>
				{/if}
			</div>

			<div class="type-filter">
				{#each SIDEBAR_TYPES as t}
					<button
						type="button"
						class="type-pill"
						class:on={activeTypes.has(t)}
						onclick={() => toggleType(t)}
						title={`Toggle ${TYPE_LABEL[t]}`}
					>
						{TYPE_LABEL[t]}
					</button>
				{/each}
			</div>
		</aside>

		<section class="wiki-content">
			{#if selectedId}
				<EntityDetail entityId={selectedId} isPopout={true} />
			{:else}
				<p class="no-selection">Pick an entity from the sidebar.</p>
			{/if}
		</section>
	</div>

	{#if contextMenu}
		<ContextMenu
			items={contextItems}
			x={contextMenu.x}
			y={contextMenu.y}
			onClose={() => (contextMenu = null)}
		/>
	{/if}
{/if}

<style>
	.wiki-layout {
		display: flex;
		height: 100%;
		min-height: 0;
	}

	.wiki-sidebar {
		flex: 0 0 240px;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface, #161920);
	}

	.sidebar-toolbar {
		padding: 8px 10px;
		border-bottom: 1px solid var(--color-border);
	}

	.search-input {
		width: 100%;
		background: var(--color-surface-2);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 12px;
		font-family: var(--font-ui, 'Inter', sans-serif);
	}
	.search-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.sidebar-list {
		flex: 1 1 0;
		overflow-y: auto;
		padding: 4px 0 8px;
	}

	.type-group {
		margin-top: 6px;
	}

	.type-divider {
		display: flex;
		align-items: center;
		padding: 6px 12px 4px;
	}
	.type-divider-label {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.entry {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 11px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		padding: 6px 14px;
		cursor: pointer;
		line-height: 1.3;
		transition: opacity 200ms ease;
	}
	.entry:hover {
		background: var(--color-surface-2);
	}
	.entry.active {
		background: var(--color-surface-2);
		color: var(--color-accent);
		font-weight: 500;
	}
	.entry.out-of-scope {
		opacity: 0.4;
	}
	.entry.out-of-scope:hover {
		opacity: 1;
	}

	.sidebar-empty {
		padding: 14px;
		font-size: 11px;
		color: var(--color-text-muted);
		font-style: italic;
		text-align: center;
	}

	.type-filter {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 8px 10px;
		border-top: 1px solid var(--color-border);
	}

	.type-pill {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 10px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		cursor: pointer;
	}
	.type-pill.on {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}
	.type-pill:hover {
		color: var(--color-text);
	}

	.wiki-content {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--color-surface-2);
	}

	.no-selection {
		margin: auto;
		font-size: 13px;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 40px;
		color: var(--color-text-muted);
		font-size: 13px;
		text-align: center;
	}
</style>
