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
		/** Story-time → cumulative track fraction (accounts for per-act weights). */
		posToFrac: (pos: number) => number;
		/** Inverse of posToFrac, for converting drag pixels back to story-time. */
		fracToPos: (frac: number) => number;
		/** Pixel width spanning [start, end) at the current track width. */
		pxForRange: (start: number, end: number) => number;
		onLockAcquire: () => void;
		onLockRelease: () => void;
		onError: (msg: string) => void;
		/** Click on a bar (not on a resize handle) selects the interval's
		 *  entity for the Timeline side panel. (D2/2B-i) */
		onSelect?: (entityId: string, intervalId: string) => void;
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
		posToFrac,
		fracToPos,
		pxForRange,
		onLockAcquire,
		onLockRelease,
		onError,
		onSelect
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
			const rawPos = fracToPos((ev.clientX - trackLeft) / trackWidthPx);
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
		{@const leftFrac = posToFrac(previewStart)}
		{@const rightFrac = posToFrac(previewEnd)}
		{@const leftPct = leftFrac * 100}
		{@const widthPct = (rightFrac - leftFrac) * 100}
		{@const widthPx = pxForRange(previewStart, previewEnd)}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bar-wrapper"
			class:resizing={resizing?.intervalId === iv.id}
			data-tooltip={tooltipFor(entity, iv)}
			style="left: {leftPct}%; width: {widthPct}%;"
			onclick={(e) => {
				// Resize handles still bubble a click on mouse-up after a
				// drag. Guard so resize doesn't open the editor.
				const t = e.target as HTMLElement;
				if (t.closest('.resize-handle')) return;
				onSelect?.(entity.id, iv.id);
			}}
		>
			<IntervalBar
				name={entity.name}
				note={dataNoteSnippet(entity)}
				tooltipText={tooltipFor(entity, iv)}
				color={colorFor(entity, idx)}
				{widthPx}
				internalBoundaries={(() => {
					// Collect boundary positions in story-time, then map them
					// through posToFrac so they land at the correct spot within
					// a possibly-non-uniformly-stretched bar.
					const boundaryPositions: number[] = [];
					const sa = Math.floor(previewStart);
					const ea = Math.floor(previewEnd - 1e-12);
					for (let i = sa + 1; i <= ea; i++) boundaryPositions.push(i);
					for (let i = sa; i <= ea; i++) {
						const m = sceneCountFor(i);
						if (m <= 1) continue;
						for (let k = 1; k < m; k++) {
							const p = i + k / m;
							if (p > previewStart + 1e-12 && p < previewEnd - 1e-12) {
								boundaryPositions.push(p);
							}
						}
					}
					boundaryPositions.sort((a, b) => a - b);
					const sf = posToFrac(previewStart);
					const ef = posToFrac(previewEnd);
					const span = ef - sf;
					if (span <= 0) return [];
					return boundaryPositions.map((p) => (posToFrac(p) - sf) / span);
				})()}
				isEvent={entity.type === 'Event'}
				onSplit={async (fraction) => {
					const atPosition = iv.startPosition + fraction * (iv.endPosition - iv.startPosition);
					try {
						await intervalsStore.splitIntervalAt(iv.id, atPosition);
					} catch (err) {
						onError((err as Error).message);
					}
				}}
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
