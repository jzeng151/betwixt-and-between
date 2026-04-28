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
			const snapped = smartSnap(Math.max(0, Math.min(rawPos, actCount)), sceneCountFor);

			if (edge === 'start') {
				if (snapped < resizing.previewEnd - 1e-9) {
					resizing = { ...resizing, previewStart: snapped };
				}
			} else {
				if (snapped > resizing.previewStart + 1e-9) {
					resizing = { ...resizing, previewEnd: snapped };
				}
			}
		}

		async function onUp() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			onLockRelease();

			if (!resizing) return;
			const { intervalId, previewStart, previewEnd } = resizing;

			let patch: { startActId?: string; startSceneId?: string | null; endActId?: string; endSceneId?: string | null };
			if (edge === 'start') {
				const fks = positionToStartFKs(previewStart, acts, scenesByActId);
				if (!fks) { resizing = null; return; }
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
		<div class="bar-wrapper" style="left: {leftPct}%; width: {widthPct}%;">
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
	}
	.resize-handle {
		position: absolute;
		top: 10px;
		bottom: 10px;
		width: 10px;
		cursor: ew-resize;
		z-index: 2;
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
