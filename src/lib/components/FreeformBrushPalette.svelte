<script lang="ts">
	/**
	 * FreeformBrushPalette — WM3 Slice A controls for the freeform brush
	 * (paint_stroke). Sibling of BrushPalette (grid cells); shown when the Brush
	 * tool is in freeform sub-mode.
	 *
	 *   • mode: fill | stamp. Fill masks a terrain tile to the stroke; stamp
	 *     scatters an Objects/ sprite along it.
	 *   • texture: fill → a terrain category (Grass/Sand/…); stamp → an Objects/
	 *     family (trees/bushes/…). Switching mode resets to a valid key for that
	 *     mode so the server validator (fill keys vs stamp keys) never rejects.
	 *   • size: normalized brush width [0.01, 0.2] of the map extent.
	 *   • softness: fill-only feathered-edge falloff [0, 1].
	 */
	import { onMount } from 'svelte';
	import {
		loadTerrainManifest,
		terrainCategories,
		firstBaseTile,
		objectStampGroups,
		type TerrainManifest
	} from '$lib/features/map/terrain-tilesets.js';

	interface Props {
		mode: 'fill' | 'stamp';
		textureKey: string;
		brushSize: number;
		softness: number;
		onSetMode: (mode: 'fill' | 'stamp') => void;
		onSetTexture: (key: string) => void;
		onSetBrushSize: (n: number) => void;
		onSetSoftness: (n: number) => void;
	}
	let { mode, textureKey, brushSize, softness, onSetMode, onSetTexture, onSetBrushSize, onSetSoftness }: Props =
		$props();

	let manifest = $state<TerrainManifest | null>(null);
	onMount(async () => {
		manifest = await loadTerrainManifest();
	});

	let fillTypes = $derived(terrainCategories(manifest));
	let stampGroups = $derived(objectStampGroups(manifest));

	function fillThumb(type: string): string | null {
		return firstBaseTile(manifest, type);
	}

	function selectMode(m: 'fill' | 'stamp') {
		if (m === mode) return;
		onSetMode(m);
		// Reset to a valid key for the new mode.
		if (m === 'fill') {
			onSetTexture(fillTypes[0] ?? 'Grass');
		} else {
			onSetTexture(stampGroups[0]?.stamps[0]?.key ?? '');
		}
	}
</script>

<div class="freeform-palette" data-testid="freeform-brush-palette">
	<div class="palette-header">
		<span class="palette-title">Freeform</span>
		<span class="palette-hint">pick a texture → drag on map to paint a stroke</span>
	</div>

	<div class="palette-body">
		<div class="mode-toggle" role="group" aria-label="Brush mode">
			<button type="button" class:armed={mode === 'fill'} aria-pressed={mode === 'fill'} onclick={() => selectMode('fill')}>
				Fill
			</button>
			<button type="button" class:armed={mode === 'stamp'} aria-pressed={mode === 'stamp'} onclick={() => selectMode('stamp')}>
				Stamp
			</button>
		</div>

		<div class="chips" aria-label={mode === 'fill' ? 'Fill terrain' : 'Stamp object'}>
			{#if mode === 'fill'}
				{#each fillTypes as type (type)}
					<button
						type="button"
						class="chip"
						class:armed={textureKey === type}
						aria-pressed={textureKey === type}
						onclick={() => onSetTexture(type)}
						title={type}
					>
						<img class="chip-tile" src={fillThumb(type)} alt="" aria-hidden="true" />
						<span class="chip-name">{type}</span>
					</button>
				{/each}
			{:else}
				{#each stampGroups as g (g.group)}
					<button
						type="button"
						class="chip"
						class:armed={g.stamps.some((s) => s.key === textureKey)}
						aria-pressed={g.stamps.some((s) => s.key === textureKey)}
						onclick={() => onSetTexture(g.stamps[0].key)}
						title={g.label}
					>
						<img class="chip-tile" src={g.stamps[0].url} alt="" aria-hidden="true" />
						<span class="chip-name">{g.label}</span>
					</button>
				{/each}
			{/if}
		</div>

		<label class="slider">
			<span>Size</span>
			<input
				type="range"
				min="0.01"
				max="0.2"
				step="0.005"
				value={brushSize}
				oninput={(e) => onSetBrushSize(parseFloat((e.currentTarget as HTMLInputElement).value))}
			/>
		</label>
		{#if mode === 'fill'}
			<label class="slider">
				<span>Soft</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={softness}
					oninput={(e) => onSetSoftness(parseFloat((e.currentTarget as HTMLInputElement).value))}
				/>
			</label>
		{/if}
	</div>
</div>

<style>
	.freeform-palette {
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
	.mode-toggle {
		display: inline-flex;
		gap: 2px;
	}
	.mode-toggle button {
		padding: 3px 10px;
		border-radius: 6px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.mode-toggle button.armed {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		flex: 1;
		min-width: 0;
		align-items: center;
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
	.chip.armed {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
		box-shadow: 0 0 0 1px var(--color-accent, #c8942a);
	}
	.chip-tile {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		object-fit: cover;
		background: #222;
	}
	.slider {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--color-text-muted, #aaa);
		font-size: 11px;
	}
	.slider input {
		width: 70px;
	}
</style>
