<script lang="ts">
	/**
	 * MapToolSelector — Slice 4 PR-F (DS4). The unified tool bar for the world
	 * map canvas. Four mutually-exclusive tools map onto CanvasMode:
	 *
	 *   Select → idle (pan/zoom, marker-click → style popover)
	 *   Brush  → brush (terrain paint; BrushPalette shows biome/size/history)
	 *   Place  → place-armed (PlaceablePalette chips arm a placeable)
	 *   Move   → move (drag a marker to author a move_entity keyframe)
	 *
	 * This bar is the single entry point for tool selection — before PR-F, brush
	 * and place each owned their own on/off toggle inside their palette. Those
	 * palettes are now detail panels shown only when their tool is active; the
	 * active tool highlights amber here.
	 *
	 * Place and Move act on Location-scoped placements, so they're disabled when
	 * the active map has no linked Location.
	 */
	import type { MapTool } from './canvas-mode.js';

	interface Props {
		tool: MapTool;
		onSelect: (tool: MapTool) => void;
		placeEnabled: boolean;
		moveEnabled: boolean;
		// Undo/redo live here (always-visible chrome) rather than inside the brush
		// palette, which is now only shown under the Brush tool. Keeps history
		// reachable from every tool — the Ctrl/Cmd+Z shortcut maps to the same path.
		canUndo?: boolean;
		canRedo?: boolean;
		onUndo?: () => void;
		onRedo?: () => void;
	}
	let {
		tool,
		onSelect,
		placeEnabled,
		moveEnabled,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo
	}: Props = $props();

	const TOOLS: Array<{ id: MapTool; label: string; glyph: string; hint: string }> = [
		{ id: 'select', label: 'Select', glyph: '⊹', hint: 'Pan, zoom, and click markers' },
		{ id: 'brush', label: 'Brush', glyph: '❖', hint: 'Paint terrain' },
		{ id: 'place', label: 'Place', glyph: '✚', hint: 'Place an entity on the map' },
		{ id: 'move', label: 'Move', glyph: '➟', hint: 'Drag a marker to author movement' }
	];

	function enabled(id: MapTool): boolean {
		if (id === 'place') return placeEnabled;
		if (id === 'move') return moveEnabled;
		return true;
	}

	// If the active tool gets disabled out from under us (e.g. the map loses its
	// Location while Move is active), fall back to Select so the bar's highlight
	// never points at a disabled button. The parent owns the actual mode reset;
	// this keeps the control's own view consistent.
	$effect(() => {
		if (!enabled(tool)) onSelect('select');
	});
</script>

<div class="tool-selector" role="toolbar" aria-label="Map tools" data-testid="map-tool-selector">
	{#each TOOLS as t (t.id)}
		<button
			type="button"
			class="tool-button"
			class:active={tool === t.id}
			aria-pressed={tool === t.id}
			disabled={!enabled(t.id)}
			title={enabled(t.id) ? t.hint : `${t.label} needs a linked Location`}
			onclick={() => onSelect(t.id)}
		>
			<span class="tool-glyph" aria-hidden="true">{t.glyph}</span>
			<span class="tool-label">{t.label}</span>
		</button>
	{/each}

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

<style>
	.tool-selector {
		display: flex;
		gap: 4px;
		padding: 6px 10px;
		background: var(--color-panel, rgba(0, 0, 0, 0.6));
		border-top: 1px solid var(--color-border, #333);
		/* Sit above the absolutely-positioned MapSidebar (z-index:100), same as
		   the palettes below it. */
		position: relative;
		z-index: 150;
	}
	.tool-button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 12px;
		border-radius: 4px;
		border: 1px solid var(--color-border, #333);
		background: var(--color-bg, #1a1a1a);
		color: var(--color-text, #ddd);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.tool-button:hover:not(:disabled):not(.active) {
		border-color: color-mix(in srgb, var(--color-accent, #c8942a) 50%, var(--color-border, #333));
	}
	.tool-button.active {
		border-color: var(--color-accent, #c8942a);
		background: color-mix(in srgb, var(--color-accent, #c8942a) 25%, transparent);
		color: var(--color-text, #fff);
	}
	.tool-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.tool-glyph {
		font-size: 12px;
		line-height: 1;
	}
	.history-controls {
		display: flex;
		gap: 4px;
		margin-left: auto;
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
