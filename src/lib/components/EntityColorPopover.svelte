<!--
  EntityColorPopover — Settings customization Phase 2, Item 2. A small anchored
  panel (clamped to viewport, dismiss on Escape / click-outside) that hosts the
  shared EntityColorField. Opened from the story-graph node right-click "Recolor"
  action so a writer can recolor an entity in place; the color is data.color, so
  it reaches the graph node, the timeline bar, AND the map sprite at once.

  Chrome mirrors PlacementStylePopover (fixed at x,y, clamp on mount, blur-commit
  before close).
-->
<script lang="ts">
	import { clampToViewport } from '$lib/os/context-menu-clamp.js';
	import { takeNextFocusReturn } from '$lib/actions/focus-trap.js';
	import EntityColorField from '$lib/components/EntityColorField.svelte';
	import type { Entity } from '$lib/stores/entities.js';

	interface Props {
		entity: Entity;
		x: number;
		y: number;
		onClose: () => void;
	}
	let { entity, x, y, onClose }: Props = $props();

	let panelEl: HTMLDivElement | undefined = $state();
	let pos = $state({ x: 0, y: 0 });
	const returnFocus = takeNextFocusReturn(
		document.activeElement instanceof HTMLElement ? document.activeElement : null
	);

	$effect(() => {
		if (!panelEl) return;
		const rect = panelEl.getBoundingClientRect();
		pos = clampToViewport(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
		queueMicrotask(() => (panelEl?.querySelector<HTMLElement>('button, input') ?? panelEl)?.focus());
	});

	$effect(() => {
		function onPointerDown(e: PointerEvent) {
			if (!panelEl) return;
			const target = e.target as Node | null;
			if (target && panelEl.contains(target)) return;
			onClose();
		}
		window.addEventListener('pointerdown', onPointerDown);
		return () => window.removeEventListener('pointerdown', onPointerDown);
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			queueMicrotask(() => returnFocus?.isConnected && returnFocus.focus());
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	bind:this={panelEl}
	class="entity-color-popover"
	style="left: {pos.x}px; top: {pos.y}px;"
	role="dialog"
	aria-label={`Color for ${entity.name}`}
	tabindex="-1"
	onkeydown={onKeydown}
>
	<span class="ecp-label">This {entity.type.toLowerCase()}</span>
	<EntityColorField {entity} />
</div>

<style>
	.entity-color-popover {
		position: fixed;
		z-index: 200;
		padding: 12px;
		background: var(--color-surface, #161920);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 8px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
		font-family: var(--font-ui, 'Inter', sans-serif);
	}
	.ecp-label {
		display: block;
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		margin-bottom: 8px;
	}
</style>
