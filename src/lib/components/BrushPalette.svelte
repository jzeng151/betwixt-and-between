<script lang="ts">
	/**
	 * BrushPalette — Slice 3 T5 brush UX.
	 *
	 * Lives below the canvas alongside PlaceablesPalette. Three pieces:
	 *
	 *   1. Mode toggle: enter/exit brush mode. While active, pointer events
	 *      on the canvas paint cells (via PixiBrushLayer). Mutually
	 *      exclusive with placement arming (orchestrator handles the cross-
	 *      exclusion).
	 *
	 *   2. Biome picker: chip rail with one chip per BIOMES enum value.
	 *      Eraser is biome='unset' rendered with a distinct (red dashed
	 *      border + ⌀ glyph) style so it's visually a tool, not a biome.
	 *
	 *   3. Size selector: three buttons (1, 3, 5 cell radius). Matches the
	 *      design-doc thread #4 prior (1/3/5 — no continuous slider for
	 *      Slice 3 MVP).
	 *
	 * Per outside-voice A2, paint_cells events have a 256-cell cap; the
	 * brush at size=5 on hex paints a 2-ring (19 cells) per gesture step,
	 * well under the cap. PixiBrushLayer chunks long drag strokes.
	 */
	import { BIOMES, type BiomeKind } from '$lib/features/map/projection.js';
	import { BIOME_STYLES } from '$lib/features/map/biome-textures.js';

	interface Props {
		active: boolean;
		biome: BiomeKind;
		size: 1 | 3 | 5;
		canUndo?: boolean;
		canRedo?: boolean;
		onSetActive: (active: boolean) => void;
		onSetBiome: (biome: BiomeKind) => void;
		onSetSize: (size: 1 | 3 | 5) => void;
		onUndo?: () => void;
		onRedo?: () => void;
	}
	let {
		active,
		biome,
		size,
		canUndo = false,
		canRedo = false,
		onSetActive,
		onSetBiome,
		onSetSize,
		onUndo,
		onRedo
	}: Props = $props();

	// Paintable biomes first; 'unset' (eraser) rendered as a separate
	// affordance to the right so it visually reads as a tool.
	const PAINTABLE_BIOMES: BiomeKind[] = BIOMES.filter((b) => b !== 'unset');
	const SIZES: Array<1 | 3 | 5> = [1, 3, 5];

	function rgbHex(color: number): string {
		return '#' + color.toString(16).padStart(6, '0');
	}
</script>

<div class="brush-palette" data-testid="brush-palette">
	<div class="palette-header">
		<span class="palette-title">Brush</span>
		<span class="palette-hint">
			{#if active}
				drag on map to paint · Shift on vertices = snap
			{:else}
				click the toggle to start painting
			{/if}
		</span>
	</div>

	<div class="palette-body">
		<button
			type="button"
			class="mode-toggle"
			class:armed={active}
			aria-pressed={active}
			onclick={() => onSetActive(!active)}
			title={active ? 'Exit brush mode' : 'Enter brush mode'}
		>
			{active ? 'Brush ON' : 'Brush'}
		</button>

		<div class="biome-chips" aria-label="Biome">
			{#each PAINTABLE_BIOMES as b (b)}
				<button
					type="button"
					class="chip"
					class:armed={biome === b}
					aria-pressed={biome === b}
					style="--biome-color: {rgbHex(BIOME_STYLES[b].color)}"
					onclick={() => onSetBiome(b)}
					title={`Paint ${b}`}
				>
					<span class="chip-swatch" aria-hidden="true"></span>
					<span class="chip-name">{b}</span>
				</button>
			{/each}
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

		<div class="history-controls" aria-label="History">
			<button
				type="button"
				class="history-button"
				disabled={!canUndo}
				onclick={() => onUndo?.()}
				title="Undo (Ctrl/Cmd+Z)"
			>
				↶ Undo
			</button>
			<button
				type="button"
				class="history-button"
				disabled={!canRedo}
				onclick={() => onRedo?.()}
				title="Redo (Ctrl/Cmd+Shift+Z)"
			>
				↷ Redo
			</button>
		</div>
	</div>
</div>

<style>
	.brush-palette {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		/* The MapSidebar (Layers/Factions) is position:absolute, right:8px,
		   width:200px and overlays the bottom-right of the map wrapper — i.e.
		   the right end of this full-width palette. The size selector is the
		   last control in the row, so it landed underneath the sidebar and
		   read as "no brush size selection". Reserve the sidebar's footprint
		   (200 + 8 right + 8 gap) so every control stays in the clear. */
		padding-right: 216px;
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
		border-top: 1px solid var(--color-border, #333);
		font-size: 12px;
		/* Sit above the MapSidebar (z-index:100) so the absolutely-positioned
		   sidebar doesn't paint over this bottom-of-column rail. */
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
		padding: 4px 10px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		min-width: 70px;
	}
	.mode-toggle.armed {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
		color: var(--color-text, #fff);
	}
	.biome-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		border-radius: 12px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--biome-color, var(--color-accent, #c8942a));
	}
	.chip.armed {
		border-color: var(--biome-color, var(--color-accent, #c8942a));
		background: color-mix(in srgb, var(--biome-color, var(--color-accent, #c8942a)) 25%, transparent);
		box-shadow: 0 0 0 1px var(--biome-color, var(--color-accent, #c8942a));
	}
	.chip-swatch {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--biome-color);
	}
	.chip.eraser {
		border-style: dashed;
		border-color: var(--color-text-muted, #888);
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
	.history-controls {
		display: flex;
		gap: 4px;
	}
	.history-button {
		padding: 4px 8px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.history-button:hover:not(:disabled) {
		border-color: var(--color-accent, #c8942a);
	}
	.history-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
