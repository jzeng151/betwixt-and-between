<script lang="ts">
	/**
	 * PlacementStylePopover — Slice 4 PR-C. Anchored panel opened from a map
	 * marker's context menu ("Edit style"). Edits:
	 *   - placement.data.style — the per-instance override (top cascade layer),
	 *     written via the placements store.
	 *   - the placeable entity's is_asset flag — palette membership. NOTE this is
	 *     an ENTITY-level property: toggling it here affects every placement of
	 *     this entity and its palette listing (per the DS1 decision to surface it
	 *     in both the entity sidebar and this popover).
	 *
	 * Positioning mirrors ContextMenu: fixed at (x, y), clamped to the viewport
	 * on mount, dismiss on Escape / click-outside.
	 */
	import { clampToViewport } from '$lib/os/context-menu-clamp.js';
	import { mapPlacements } from '$lib/stores/map-placements.js';
	import { entities } from '$lib/stores/entities.js';
	import { resolveStyle, type StyleOverride } from '$lib/features/map/style-cascade.js';
	import StyleEditor from '$lib/components/StyleEditor.svelte';
	import type { MapPlacement } from '$lib/types/map-placement.js';
	import type { Entity } from '$lib/stores/entities.js';

	interface Props {
		placement: MapPlacement;
		placeable: Entity;
		x: number;
		y: number;
		onClose: () => void;
	}
	let { placement, placeable, x, y, onClose }: Props = $props();

	let panelEl: HTMLDivElement | undefined = $state();
	let pos = $state({ x: 0, y: 0 });

	// Per-instance override value + the entity-level resolved baseline (cascade
	// without the placement layer) for the StyleEditor placeholders.
	const styleValue = $derived(((placement.data?.style ?? {}) as StyleOverride));
	const inheritedStyle = $derived(resolveStyle(placeable));
	const inPalette = $derived(
		(placeable.data as Record<string, unknown>)?.is_asset !== false
	);

	async function persistStyle(next: StyleOverride) {
		const data = { ...(placement.data ?? {}) };
		if (Object.keys(next).length === 0) delete data.style;
		else data.style = next;
		await mapPlacements.update(placement.id, { data });
	}

	async function setInPalette(v: boolean) {
		const data = { ...(placeable.data as Record<string, unknown>) };
		if (v) delete data.is_asset; // default true
		else data.is_asset = false;
		await entities.updateEntity(placeable.id, { data });
	}

	$effect(() => {
		if (!panelEl) return;
		const rect = panelEl.getBoundingClientRect();
		pos = clampToViewport(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
	});

	$effect(() => {
		function onPointerDown(e: PointerEvent) {
			if (!panelEl) return;
			const target = e.target as Node | null;
			if (target && panelEl.contains(target)) return;
			// Codex P2: the StyleEditor's color/icon fields commit on blur, but
			// this pointerdown fires before the focused input blurs. Blur it
			// first so a typed-but-uncommitted draft is persisted, not discarded.
			const active = document.activeElement;
			if (active instanceof HTMLElement && panelEl.contains(active)) active.blur();
			onClose();
		}
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={panelEl}
	class="placement-style-popover"
	style="left: {pos.x}px; top: {pos.y}px;"
	role="dialog"
	aria-label={`Style for ${placeable.name}`}
	tabindex="-1"
	onkeydown={onKeydown}
>
	<header class="pop-header">
		<span class="pop-title">{placeable.name}</span>
		<button type="button" class="pop-close" title="Close" onclick={onClose}>✕</button>
	</header>
	<StyleEditor value={styleValue} inherited={inheritedStyle} onChange={persistStyle} />
	<label class="is-asset-toggle">
		<input
			type="checkbox"
			checked={inPalette}
			onchange={(e) => setInPalette((e.currentTarget as HTMLInputElement).checked)}
		/>
		Show in placeables palette
	</label>
</div>

<style>
	.placement-style-popover {
		position: fixed;
		z-index: 200;
		width: 240px;
		padding: 12px;
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 8px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
		font-family: var(--font-ui, 'Inter', sans-serif);
	}
	.pop-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.pop-title {
		font-family: var(--font-display, 'Fraunces', serif);
		font-size: 15px;
		color: var(--color-text, #e8e0d0);
	}
	.pop-close {
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 12px;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.pop-close:hover {
		color: var(--color-text, #e8e0d0);
	}
	.is-asset-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
		font-size: 11px;
		color: var(--color-text, #e8e0d0);
		cursor: pointer;
	}
	.is-asset-toggle input {
		accent-color: var(--color-accent, #c8942a);
	}
</style>
