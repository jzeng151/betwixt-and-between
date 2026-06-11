<!--
  PlayheadOverlay — vertical scrub line at the current $playhead position.
  Parent must supply an absolute-positioned container (.rows in Timeline.svelte).
-->
<script lang="ts">
	import { playhead } from '$lib/features/timeline/playhead-store.js';

	interface Props {
		trackWidthPx: number;
		actCount: number;
		posToFrac?: (pos: number) => number;
	}
	let {
		trackWidthPx,
		actCount,
		posToFrac = (p: number) => (actCount === 0 ? 0 : p / actCount)
	}: Props = $props();

	const leftPx = $derived(
		$playhead == null || actCount === 0 || trackWidthPx === 0
			? null
			: posToFrac($playhead) * trackWidthPx
	);

	function startDrag(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		const handleEl = e.currentTarget as HTMLElement;
		// Walk up to find the parent track (the .rows div).
		const trackEl = handleEl.closest('.rows') as HTMLElement | null;
		if (!trackEl) return;
		const trackLeft = trackEl.getBoundingClientRect().left;

		// rAF coalescing (2026-06 perf audit): pointermove fires at the mouse's
		// report rate (125–240Hz on gaming mice) — each scrubTo cascades into
		// projectState + every Pixi map layer, so scrubbing paid 2–4× the
		// display refresh for no visible benefit. Store the latest clientX and
		// emit at most one scrubTo per animation frame.
		let pendingClientX: number | null = null;
		let rafId: number | null = null;

		function flushScrub() {
			rafId = null;
			if (pendingClientX === null) return;
			const clientX = pendingClientX;
			pendingClientX = null;
			if (trackWidthPx === 0 || actCount === 0) return;
			// Pixel → cumulative fraction → story-time. We don't have the
			// inverse here, so do a binary search via posToFrac. For typical
			// N <= 20 acts a linear scan over weights would work too, but
			// since we only have posToFrac, use bisection.
			const targetFrac = (clientX - trackLeft) / trackWidthPx;
			let lo = 0;
			let hi = actCount;
			for (let i = 0; i < 30; i++) {
				const mid = (lo + hi) / 2;
				if (posToFrac(mid) < targetFrac) lo = mid;
				else hi = mid;
			}
			const clamped = Math.max(0, Math.min((lo + hi) / 2, actCount));
			playhead.scrubTo(clamped);
		}
		function onMove(ev: PointerEvent) {
			pendingClientX = ev.clientX;
			if (rafId === null) rafId = requestAnimationFrame(flushScrub);
		}
		function onUp() {
			// Flush the last position synchronously so the release point lands.
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			flushScrub();
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		}
		// pointercancel (touch interrupted, browser-stolen gesture) must tear down
		// too — otherwise the window pointermove listener + the rAF leak and every
		// later cancelled drag stacks another scrub computation (2026-06 review).
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}
</script>

{#if leftPx != null}
	<div
		class="playhead"
		role="slider"
		aria-label="Spotlight position"
		aria-valuemin="0"
		aria-valuemax={actCount}
		aria-valuenow={$playhead ?? 0}
		tabindex="0"
		style="left: {leftPx}px;"
		onpointerdown={startDrag}
	>
		<div class="playhead-handle" aria-hidden="true"></div>
	</div>
{/if}

<style>
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--color-accent, #c8942a);
		pointer-events: auto;
		cursor: ew-resize;
		z-index: 8;
		box-shadow: 0 0 8px rgba(200, 148, 42, 0.4);
	}
	.playhead:focus {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-accent, #c8942a), 0 0 8px rgba(200, 148, 42, 0.6);
	}
	.playhead-handle {
		position: absolute;
		top: -4px;
		left: -5px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent, #c8942a);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
	}
</style>
