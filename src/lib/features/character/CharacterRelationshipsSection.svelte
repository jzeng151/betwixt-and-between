<!--
  CharacterRelationshipsSection — the 6 REL_GROUPS rendered as chip rows
  with a "+" picker dropdown per group. Owns pickerGroup local state and
  closes its dropdown when readOnly transitions false → true (parent
  Cancel/Done). Errors from add/remove are reported up via onError so
  the body can show a single unified save-error message.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { relationships, type Relationship } from '$lib/stores/relationships.js';
	import EntityLink from '$lib/components/EntityLink.svelte';
	import type { RelationshipType, EntityType } from '$lib/server/db/schema.js';
	import type { Entity } from '$lib/stores/entities.js';

	interface Props {
		entityId: string;
		readOnly: boolean;
		onError: (msg: string) => void;
	}
	const { entityId, readOnly, onError }: Props = $props();

	const REL_GROUPS: { label: string; type: RelationshipType }[] = [
		{ label: 'Allies',      type: 'allied_with' },
		{ label: 'Rivals',      type: 'rivals' },
		{ label: 'Mentors',     type: 'mentor_of' },
		{ label: 'Others',      type: 'other' },
		{ label: 'Locations',   type: 'located_at' },
		{ label: 'Key Events',  type: 'takes_place_at' }
	];

	const PICKER_TYPES: Partial<Record<RelationshipType, EntityType[]>> = {
		allied_with:    ['Character'],
		rivals:         ['Character'],
		mentor_of:      ['Character'],
		other:          ['Character'],
		located_at:     ['Location'],
		takes_place_at: ['Event', 'Scene'],
		caused_by:      ['Event', 'Scene']
	};

	let pickerGroup: RelationshipType | null = $state(null);

	// Close any open picker when the parent flips us into view mode.
	// Mirrors the body's own readOnly-transition $effect; tracked with a
	// plain `let` so the effect doesn't re-run on its own assignment.
	// svelte-ignore state_referenced_locally
	let _prevReadOnly = readOnly;
	$effect(() => {
		const next = readOnly;
		if (next && !_prevReadOnly) pickerGroup = null;
		_prevReadOnly = next;
	});

	function getLinked(type: RelationshipType): { rel: Relationship; other: Entity }[] {
		if (!entityId) return [];
		const out: { rel: Relationship; other: Entity }[] = [];
		for (const r of $relationships) {
			if (r.type !== type) continue;
			if (r.fromId !== entityId && r.toId !== entityId) continue;
			const linkedId = r.fromId === entityId ? r.toId : r.fromId;
			const other = $entities.find((e) => e.id === linkedId);
			if (other) out.push({ rel: r, other });
		}
		return out;
	}

	function pickerOptions(relType: RelationshipType) {
		const types = PICKER_TYPES[relType] ?? [];
		const linked = new Set(getLinked(relType).map(({ other }) => other.id));
		return $entities.filter(
			(e) => types.includes(e.type as EntityType) && e.id !== entityId && !linked.has(e.id)
		);
	}

	async function removeRelationship(id: string) {
		try {
			await relationships.deleteRelationship(id);
		} catch {
			onError("Couldn't remove relationship.");
		}
	}

	async function pickEntity(relType: RelationshipType, targetId: string) {
		pickerGroup = null;
		try {
			await relationships.createRelationship(entityId, targetId, relType);
		} catch {
			onError("Couldn't add relationship.");
		}
	}
</script>

{#if !readOnly && pickerGroup}
	<div
		class="picker-backdrop"
		role="presentation"
		onclick={() => (pickerGroup = null)}
		onkeydown={() => (pickerGroup = null)}
	></div>
{/if}

{#each REL_GROUPS as group}
	{@const linked = getLinked(group.type)}
	<section class="rel-group">
		<p class="section-label">{group.label}</p>
		<div class="chip-row">
			{#each linked as link (link.rel.id)}
				<EntityLink
					id={link.other.id}
					name={link.other.name}
					relationshipType={group.type}
					onRemove={!readOnly ? () => removeRelationship(link.rel.id) : undefined}
				/>
			{/each}
			<div class="picker-wrap">
				{#if !readOnly}
					<button
						class="chip-add"
						class:chip-add-open={pickerGroup === group.type}
						onclick={() => (pickerGroup = pickerGroup === group.type ? null : group.type)}
						title="Add {group.label}"
					>+</button>
				{/if}
				{#if !readOnly && pickerGroup === group.type}
					{@const opts = pickerOptions(group.type)}
					<div class="picker-dropdown">
						{#if opts.length === 0}
							<p class="picker-empty">Nothing available to add.</p>
						{:else}
							{#each opts as opt}
								<button class="picker-item" onclick={() => pickEntity(group.type, opt.id)}>
									<span class="picker-name">{opt.name}</span>
									<span class="picker-type">{opt.type}</span>
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</section>
{/each}

<style>
	.rel-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.section-label {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin: 0;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		align-items: center;
	}

	.chip-add {
		background: transparent;
		border: 1px dashed var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		border-radius: 999px;
		width: 22px;
		height: 22px;
		font-size: 12px;
		cursor: pointer;
	}
	.chip-add:hover {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}
	.chip-add-open {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.picker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 5;
	}

	.picker-wrap { position: relative; }

	.picker-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 200px;
		max-height: 240px;
		overflow-y: auto;
		background: var(--color-surface-2, #1c1f28);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 6px;
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
		padding: 4px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.picker-item {
		background: transparent;
		border: none;
		color: var(--color-text);
		text-align: left;
		font-size: 11px;
		padding: 4px 8px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		border-radius: 4px;
	}
	.picker-item:hover { background: var(--color-surface, #161920); }

	.picker-name { color: var(--color-text); }
	.picker-type {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.picker-empty {
		font-size: 11px;
		color: var(--color-text-muted, #6b7280);
		font-style: italic;
		padding: 6px 8px;
		margin: 0;
	}
</style>
