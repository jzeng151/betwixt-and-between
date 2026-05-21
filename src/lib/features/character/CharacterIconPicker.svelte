<!--
  CharacterIconPicker — 8-col icon grid grouped by category, plus an
  optional "Clear icon" button. Pure-view: receives the current icon id
  and emits pick/clear callbacks. Parent owns the open/closed state.
-->

<script lang="ts">
	import {
		listCharacterIcons,
		CHARACTER_ICON_CATEGORIES,
		getCharacterIcon,
		type IconCategory
	} from '$lib/icons/registry.js';

	interface Props {
		selectedIcon: string;
		onPick: (id: string) => Promise<void>;
		onClear: () => Promise<void>;
	}
	const { selectedIcon, onPick, onClear }: Props = $props();

	const iconEntry = $derived(getCharacterIcon(selectedIcon));

	function iconsInCategory(cat: IconCategory) {
		return listCharacterIcons().filter((i) => i.category === cat);
	}
</script>

<div class="icon-picker">
	{#each CHARACTER_ICON_CATEGORIES as cat}
		<div class="icon-picker-cat">
			<p class="section-label">{cat}</p>
			<div class="icon-grid">
				{#each iconsInCategory(cat) as entry}
					{@const IconComp = entry.component}
					<button
						type="button"
						class="icon-tile"
						class:icon-tile-selected={selectedIcon === entry.id}
						title={entry.label}
						aria-label={entry.label}
						aria-pressed={selectedIcon === entry.id}
						onclick={() => onPick(entry.id)}
					>
						<IconComp size={20} strokeWidth={1.6} />
					</button>
				{/each}
			</div>
		</div>
	{/each}
	{#if iconEntry}
		<button type="button" class="icon-picker-clear" onclick={onClear}>Clear icon</button>
	{/if}
</div>

<style>
	.icon-picker {
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 6px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.icon-picker-cat { display: flex; flex-direction: column; gap: 4px; }

	.section-label {
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin: 0;
	}

	.icon-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 4px;
	}

	.icon-tile {
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text);
		border-radius: 4px;
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.icon-tile:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
	.icon-tile-selected {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
	}

	.icon-picker-clear {
		align-self: flex-start;
		background: transparent;
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text-muted, #6b7280);
		font-size: 10px;
		padding: 3px 8px;
		border-radius: 4px;
		cursor: pointer;
	}
	.icon-picker-clear:hover { color: var(--color-text); }
</style>
