<script lang="ts">
	/**
	 * BrushPalette — terrain paint UX. Slice 6 D15/D16: asset-folder-driven, and
	 * the brush paints a SPECIFIC chosen texture (not one fixed tile per type).
	 *
	 *   1. Land: one chip per manifest category (Clay/Grass/Ice/Lava/Paving/
	 *      Sand/Snow). Clicking a chip opens a POPOVER of that type's textures;
	 *      clicking a swatch arms that exact tile and closes the popover.
	 *   2. Water: a SINGLE "Water" chip whose popover holds the water colors
	 *      (water_*) — the 7 colors are grouped under one terrain (D16).
	 *   3. Eraser: biome='unset', styled as a tool not a terrain (no popover).
	 *
	 * The painted cell stores the chosen texture key (a tile basename like
	 * "grass_01_tile_256_05", or a water color key like "water_snow"). Size
	 * selector unchanged (1/3/5 cell radius).
	 */
	import { onMount } from 'svelte';
	import {
		loadTerrainManifest,
		terrainCategories,
		texturesForType,
		typeForKey,
		tileUrlForKey,
		firstBaseTile,
		WATER_TYPE,
		type TerrainManifest
	} from '$lib/features/map/terrain-tilesets.js';

	interface Props {
		biome: string;
		size: 1 | 3 | 5;
		onSetBiome: (biome: string) => void;
		onSetSize: (size: 1 | 3 | 5) => void;
	}
	let { biome, size, onSetBiome, onSetSize }: Props = $props();

	let manifest = $state<TerrainManifest | null>(null);
	onMount(async () => {
		manifest = await loadTerrainManifest();
	});

	// Which type's texture popover is open (a land category, WATER_TYPE, or null).
	let openType = $state<string | null>(null);

	let landTypes = $derived(terrainCategories(manifest));
	let hasWater = $derived(texturesForType(manifest, WATER_TYPE).length > 0);
	// The terrain type the current brush belongs to → which chip reads as armed.
	let armedType = $derived(typeForKey(manifest, biome));
	const SIZES: Array<1 | 3 | 5> = [1, 3, 5];

	function toggleType(type: string) {
		openType = openType === type ? null : type;
	}
	function pickTexture(key: string) {
		onSetBiome(key);
		openType = null;
	}
	// The thumbnail on a type chip: the armed texture when that type is armed,
	// else the type's representative (first) tile.
	function chipThumb(type: string): string | null {
		if (armedType === type) {
			const u = tileUrlForKey(manifest, biome);
			if (u) return u;
		}
		if (type === WATER_TYPE) return texturesForType(manifest, WATER_TYPE)[0]?.url ?? null;
		return firstBaseTile(manifest, type);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && openType) openType = null;
	}}
/>

<div class="brush-palette" data-testid="brush-palette">
	<div class="palette-header">
		<span class="palette-title">Brush</span>
		<span class="palette-hint">click a terrain → pick a texture → drag on map to paint</span>
	</div>

	<div class="palette-body">
		<div class="terrain-chips" aria-label="Terrain">
			{#each landTypes as type (type)}
				<div class="chip-wrap">
					<button
						type="button"
						class="chip"
						class:armed={armedType === type}
						class:open={openType === type}
						aria-haspopup="true"
						aria-expanded={openType === type}
						aria-pressed={armedType === type}
						onclick={() => toggleType(type)}
						title={`${type} — pick a texture`}
					>
						<img class="chip-tile" src={chipThumb(type)} alt="" aria-hidden="true" />
						<span class="chip-name">{type}</span>
						<span class="chip-caret" aria-hidden="true">▾</span>
					</button>

					{#if openType === type}
						{@render popover(type)}
					{/if}
				</div>
			{/each}

			{#if hasWater}
				<span class="group-sep" aria-hidden="true"></span>
				<div class="chip-wrap">
					<button
						type="button"
						class="chip water"
						class:armed={armedType === WATER_TYPE}
						class:open={openType === WATER_TYPE}
						aria-haspopup="true"
						aria-expanded={openType === WATER_TYPE}
						aria-pressed={armedType === WATER_TYPE}
						onclick={() => toggleType(WATER_TYPE)}
						title="Water — pick a color"
					>
						<img class="chip-tile" src={chipThumb(WATER_TYPE)} alt="" aria-hidden="true" />
						<span class="chip-name">Water</span>
						<span class="chip-caret" aria-hidden="true">▾</span>
					</button>

					{#if openType === WATER_TYPE}
						{@render popover(WATER_TYPE)}
					{/if}
				</div>
			{/if}

			<button
				type="button"
				class="chip eraser"
				class:armed={biome === 'unset'}
				aria-pressed={biome === 'unset'}
				onclick={() => onSetBiome('unset')}
				title="Erase (paint cells back to transparent)"
			>
				<span class="eraser-glyph" aria-hidden="true">⌀</span>
				<span class="chip-name">Erase</span>
			</button>
		</div>

		<div class="size-selector" aria-label="Brush size">
			{#each SIZES as s (s)}
				<button
					type="button"
					class="size-button"
					class:armed={size === s}
					aria-pressed={size === s}
					onclick={() => onSetSize(s)}
					title={`Brush radius ${s}`}
				>
					{s}
				</button>
			{/each}
		</div>
	</div>
</div>

{#if openType}
	<!-- Click-away closes the open popover; sits under the popovers, over the map. -->
	<button class="popover-backdrop" aria-label="Close texture picker" onclick={() => (openType = null)}
	></button>
{/if}

{#snippet popover(type: string)}
	<div class="texture-popover" role="menu" aria-label={`${type} textures`}>
		{#each texturesForType(manifest, type) as tex (tex.key)}
			<button
				type="button"
				class="swatch"
				class:armed={biome === tex.key}
				role="menuitemradio"
				aria-checked={biome === tex.key}
				title={tex.label}
				onclick={() => pickTexture(tex.key)}
			>
				<img src={tex.url} alt={tex.label} />
			</button>
		{/each}
	</div>
{/snippet}

<style>
	.brush-palette {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		padding-right: 216px;
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
		border-top: 1px solid var(--color-border, #333);
		font-size: 12px;
		position: relative;
		z-index: 150;
	}
	.palette-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.palette-title {
		font-weight: 600;
		color: var(--color-text, #ddd);
	}
	.palette-hint {
		color: var(--color-text-muted, #888);
		font-style: italic;
		font-size: 11px;
	}
	.palette-body {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.terrain-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		flex: 1;
		min-width: 0;
		align-items: center;
	}
	.chip-wrap {
		position: relative;
		display: inline-flex;
	}
	.group-sep {
		width: 1px;
		align-self: stretch;
		background: var(--color-border, #333);
		margin: 2px 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px 3px 4px;
		border-radius: 12px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--color-accent, #c8942a);
	}
	.chip.open {
		border-color: var(--color-accent, #c8942a);
	}
	.chip.armed {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
		box-shadow: 0 0 0 1px var(--color-accent, #c8942a);
	}
	.chip.water.armed {
		border-color: #38bdf8;
		box-shadow: 0 0 0 1px #38bdf8;
		background: color-mix(in srgb, #38bdf8 22%, transparent);
	}
	.chip-tile {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		object-fit: cover;
		background: #222;
	}
	.chip-caret {
		font-size: 9px;
		opacity: 0.6;
		margin-left: -2px;
	}
	.chip.eraser {
		border-style: dashed;
		border-color: var(--color-text-muted, #888);
		padding-left: 8px;
	}
	.chip.eraser:hover {
		border-color: #ef4444;
	}
	.chip.eraser.armed {
		border-color: #ef4444;
		border-style: solid;
		background: color-mix(in srgb, #ef4444 18%, transparent);
		box-shadow: 0 0 0 1px #ef4444;
	}
	.eraser-glyph {
		font-size: 11px;
		line-height: 1;
		opacity: 0.85;
	}

	/* Texture popover — floats above the clicked chip. */
	.popover-backdrop {
		position: fixed;
		inset: 0;
		/* BELOW .brush-palette (z-index:150) on purpose. The palette is a
		   positioned z-index stacking context, so the popover (z-index:210
		   inside it) paints as part of the palette at root level 150. A backdrop
		   at a HIGHER root z-index would paint above the trapped popover and
		   eat the swatch clicks (Codex #70 P1). 140 keeps it above the map +
		   sidebar (z-index:100) so outside clicks still dismiss, but below the
		   palette so swatch/chip clicks land. */
		z-index: 140;
		background: transparent;
		border: none;
		padding: 0;
		cursor: default;
	}
	.texture-popover {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		z-index: 210;
		display: grid;
		grid-template-columns: repeat(6, 30px);
		gap: 4px;
		padding: 6px;
		max-height: 188px;
		overflow-y: auto;
		background: var(--color-panel-solid, #15161a);
		border: 1px solid var(--color-border, #333);
		border-radius: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
	}
	.swatch {
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 4px;
		border: 1px solid var(--color-border, #333);
		background: #222;
		cursor: pointer;
		overflow: hidden;
		line-height: 0;
	}
	.swatch img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.swatch:hover {
		border-color: var(--color-accent, #c8942a);
	}
	.swatch.armed {
		border-color: var(--color-accent, #c8942a);
		box-shadow: 0 0 0 2px var(--color-accent, #c8942a);
	}

	.size-selector {
		display: flex;
		gap: 2px;
	}
	.size-button {
		width: 24px;
		height: 24px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.size-button.armed {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
	}
</style>
