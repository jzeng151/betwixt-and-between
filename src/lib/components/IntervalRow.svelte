<!--
  IntervalRow — one entity's row of IntervalBars for TimelineV2.

  Renders all intervals for one entity as positioned bars across the track.
  Each bar has invisible left/right edge-resize handles (pointer events).
  Live preview during resize via local `resizing` state; final PATCH sends FK
  references resolved from the snapped float position.
-->

<script lang="ts">
	import IntervalBar from '$lib/components/IntervalBar.svelte';
	import {
		internalActBoundaryFractions,
		smartSnap,
		positionToStartFKs,
		positionToEndFKs
	} from '$lib/timeline-v2-helpers.js';
	import { intervals as intervalsStore } from '$lib/stores/intervals.js';
	import type { Entity } from '$lib/stores/entities.js';
	import type { Interval } from '$lib/stores/intervals.js';

	interface Props {
		entity: Entity;
		intervals: Interval[];
		idx: number;
		trackWidthPx: number;
		actCount: number;
		acts: Entity[];
		scenesByActId: Map<string, Entity[]>;
		colorFor: (entity: Entity, idx: number) => string;
		dataNoteSnippet: (entity: Entity) => string | null;
		tooltipFor: (entity: Entity, interval: Interval) => string;
		pxForFractionalSpan: (span: number) => number;
		onLockAcquire: () => void;
		onLockRelease: () => void;
		onError: (msg: string) => void;
	}
	let {
		entity,
		intervals,
		idx,
		trackWidthPx,
		actCount,
		acts,
		scenesByActId,
		colorFor,
		dataNoteSnippet,
		tooltipFor,
		pxForFractionalSpan,
		onLockAcquire,
		onLockRelease,
		onError
	}: Props = $props();

	let rowEl: HTMLDivElement | null = $state(null);

	// Local resize state for live preview — null when not resizing.
	type ResizeState = {
		intervalId: string;
		edge: 'start' | 'end';
		previewStart: number;
		previewEnd: number;
	};
	let resizing: ResizeState | null = $state(null);

	// Scene count lookup for smartSnap — reads current acts/scenesByActId.
	function sceneCountFor(actIdx: number): number {
		const act = acts[actIdx];
		if (!act) return 0;
		return scenesByActId.get(act.id)?.length ?? 0;
	}

	function startResize(e: PointerEvent, iv: Interval, edge: 'start' | 'end') {
		e.preventDefault();
		e.stopPropagation();

		// Capture track left offset at drag start (stable for the duration of the drag).
		const trackLeft = rowEl?.getBoundingClientRect().left ?? 0;

		resizing = {
			intervalId: iv.id,
			edge,
			previewStart: iv.startPosition,
			previewEnd: iv.endPosition
		};
		onLockAcquire();

		function onMove(ev: PointerEvent) {
			if (!resizing) return;
			const rawPos = ((ev.clientX - trackLeft) / trackWidthPx) * actCount;
			const clamped = Math.max(0, Math.min(rawPos, actCount));
			// Default: free-fraction. Hold Alt to snap to act/scene grid.
			const next = ev.altKey ? smartSnap(clamped, sceneCountFor) : clamped;

			if (edge === 'start') {
				if (next < resizing.previewEnd - 1e-9) {
					resizing = { ...resizing, previewStart: next };
				}
			} else {
				if (next > resizing.previewStart + 1e-9) {
					resizing = { ...resizing, previewEnd: next };
				}
			}
		}

		async function onUp() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			onLockRelease();

			if (!resizing) return;
			const { intervalId, previewStart, previewEnd } = resizing;

			let patch: {
				startActId?: string;
				startSceneId?: string | null;
				endActId?: string;
				endSceneId?: string | null;
				startPosition?: number;
				endPosition?: number;
			};
			if (edge === 'start') {
				const fks = positionToStartFKs(previewStart, acts, scenesByActId);
				if (!fks) { resizing = null; return; }
				// fks.startPosition is canonicalized — when the resolver picks an
				// integer-aligned boundary, the position snaps to it. Otherwise
				// it's the raw fractional position, carrying the precision.
				patch = fks;
			} else {
				const fks = positionToEndFKs(previewEnd, acts, scenesByActId);
				if (!fks) { resizing = null; return; }
				patch = fks;
			}

			try {
				await intervalsStore.updateInterval(intervalId, patch);
			} catch (err) {
				onError((err as Error).message);
			} finally {
				resizing = null;
			}
		}

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// Re-render when track width changes (pxForFractionalSpan closes over it).
	$effect(() => {
		void trackWidthPx;
	});
</script>

<div class="row" data-entity-id={entity.id} bind:this={rowEl}>
	{#each intervals as iv (iv.id)}
		{@const previewStart = resizing?.intervalId === iv.id ? resizing.previewStart : iv.startPosition}
		{@const previewEnd = resizing?.intervalId === iv.id ? resizing.previewEnd : iv.endPosition}
		{@const span = previewEnd - previewStart}
		{@const leftPct = (previewStart / Math.max(actCount, 1)) * 100}
		{@const widthPct = (span / Math.max(actCount, 1)) * 100}
		{@const widthPx = pxForFractionalSpan(span)}
		<div
			class="bar-wrapper"
			class:resizing={resizing?.intervalId === iv.id}
			data-tooltip={tooltipFor(entity, iv)}
			style="left: {leftPct}%; width: {widthPct}%;"
		>
			<IntervalBar
				name={entity.name}
				note={dataNoteSnippet(entity)}
				tooltipText={tooltipFor(entity, iv)}
				color={colorFor(entity, idx)}
				{widthPx}
				internalBoundaries={internalActBoundaryFractions(previewStart, previewEnd)}
				isEvent={entity.type === 'Event'}
			/>
			<div
				class="resize-handle resize-handle--left"
				role="button"
				aria-label="Drag to resize interval start"
				tabindex="-1"
				onpointerdown={(e) => startResize(e, iv, 'start')}
			></div>
			<div
				class="resize-handle resize-handle--right"
				role="button"
				aria-label="Drag to resize interval end"
				tabindex="-1"
				onpointerdown={(e) => startResize(e, iv, 'end')}
			></div>
		</div>
	{/each}
</div>

<style>
	.row {
		height: 56px;
		border-bottom: 1px solid var(--color-border, #2a2d35);
		position: relative;
	}
	.row:last-child {
		border-bottom: none;
	}
	.bar-wrapper {
		position: absolute;
		top: 0;
		bottom: 0;
		/* Focus glow on the bar when it's being resized — matches the locked
		   v2 mockup's `.interval.with-handles` box-shadow rule. The glow lives
		   on the wrapper so it survives the SVG bar's clipping. */
	}
	/* Styled tooltip on bar hover — matches the locked v2 mockup
	   (mockup CSS lines 311-349). Reads from the wrapper's
	   `data-tooltip` attribute. Hidden by default; fades in on
	   :hover and :focus-within so keyboard users see it too. */
	.bar-wrapper::before {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-surface-2, #1c1f28);
		color: var(--color-text, #e8e0d0);
		border: 1px solid var(--color-border, #2a2d35);
		border-radius: 4px;
		padding: 6px 10px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		font-size: 11px;
		font-weight: 400;
		white-space: nowrap;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
		z-index: 5;
	}
	.bar-wrapper::after {
		content: '';
		position: absolute;
		bottom: calc(100% - 1px);
		left: 50%;
		transform: translateX(-50%);
		width: 0;
		height: 0;
		border-left: 5px solid transparent;
		border-right: 5px solid transparent;
		border-top: 5px solid var(--color-border, #2a2d35);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	.bar-wrapper:hover::before,
	.bar-wrapper:hover::after,
	.bar-wrapper:focus-within::before,
	.bar-wrapper:focus-within::after {
		opacity: 1;
	}
	.bar-wrapper.resizing :global(svg.interval-bar) {
		box-shadow: 0 0 0 2px rgba(200, 148, 42, 0.45);
		border-radius: 4px;
	}
	/* Resize handles. Mockup spec: 4px wide vertical bar in amber, only
	   visible on hover/focus or while resizing. We render a wider hit-box
	   (10px) for ergonomics but the visible mark is 4px via inner gradient. */
	.resize-handle {
		position: absolute;
		top: 14px;
		bottom: 14px;
		width: 10px;
		cursor: ew-resize;
		z-index: 2;
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.resize-handle::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 4px;
		transform: translateX(-50%);
		background: var(--color-accent, #c8942a);
		border-radius: 1px;
	}
	.bar-wrapper:hover .resize-handle,
	.bar-wrapper:focus-within .resize-handle,
	.bar-wrapper.resizing .resize-handle {
		opacity: 1;
	}
	.resize-handle--left {
		left: 0;
		transform: translateX(-50%);
	}
	.resize-handle--right {
		right: 0;
		transform: translateX(50%);
	}
</style>
