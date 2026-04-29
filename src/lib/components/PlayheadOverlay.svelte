<!--
  PlayheadOverlay — vertical line at the current $playhead position over a
  track of width `trackWidthPx` covering `actCount` acts.

  Renders only when $playhead is non-null. Click anywhere on the track
  scrubs to that position; click+drag on the line moves it.

  Parent supplies the absolute-positioned container (the `.rows` div in
  Timeline.svelte). The overlay is meant to sit on top, pointer-events
  on the line itself.
-->
<script lang="ts">
	import { playhead } from '$lib/stores/playhead.js';

	interface Props {
		trackWidthPx: number;
		actCount: number;
	}
	let { trackWidthPx, actCount }: Props = $props();

	const leftPx = $derived(
		$playhead == null || actCount === 0 || trackWidthPx === 0
			? null
			: ($playhead / actCount) * trackWidthPx
	);

	function startDrag(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		const handleEl = e.currentTarget as HTMLElement;
		// Walk up to find the parent track (the .rows div).
		const trackEl = handleEl.closest('.rows') as HTMLElement | null;
		if (!trackEl) return;
		const trackLeft = trackEl.getBoundingClientRect().left;

		function onMove(ev: PointerEvent) {
			if (trackWidthPx === 0 || actCount === 0) return;
			const rawT = ((ev.clientX - trackLeft) / trackWidthPx) * actCount;
			const clamped = Math.max(0, Math.min(rawT, actCount));
			playhead.scrubTo(clamped);
		}
		function onUp() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

{#if leftPx != null}
	<div
		class="playhead"
		role="slider"
		aria-label="Story-time playhead"
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
