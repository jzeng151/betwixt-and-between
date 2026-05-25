<script lang="ts">
	// In-app strangler-fig renderer toggle. Two-pill segmented control;
	// clicking the inactive pill calls SvelteKit's goto() to swap
	// `?renderer=...` via client-side navigation — the `$derived(currentRenderer())`
	// in WorldMap.svelte then re-evaluates and the `{#if}` branch remounts
	// just the renderer, NOT the whole /app SPA (no window-state loss).
	//
	// Δ1b-C's "toggle 20× without WebGL warnings" test uses these buttons
	// as its Playwright target.

	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Renderer } from './renderer-flag.js';

	let { current }: { current: Renderer } = $props();

	async function swapTo(target: Renderer) {
		if (target === current) return;
		const next = new URL(page.url);
		if (target === 'leaflet') {
			// Default; drop the param so the URL stays clean.
			next.searchParams.delete('renderer');
		} else {
			next.searchParams.set('renderer', target);
		}
		await goto(next, { replaceState: false, noScroll: true, keepFocus: true });
	}
</script>

<div class="renderer-toggle" role="group" aria-label="Renderer">
	<button
		type="button"
		class="renderer-pill"
		class:active={current === 'leaflet'}
		aria-pressed={current === 'leaflet'}
		onclick={() => swapTo('leaflet')}
	>
		Leaflet
	</button>
	<button
		type="button"
		class="renderer-pill"
		class:active={current === 'pixi'}
		aria-pressed={current === 'pixi'}
		onclick={() => swapTo('pixi')}
	>
		Pixi
	</button>
</div>

<style>
	.renderer-toggle {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1000;
		display: inline-flex;
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 2px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		font-size: 11px;
		font-family: inherit;
	}
	.renderer-pill {
		background: transparent;
		border: none;
		color: var(--color-text-muted, #9ca3af);
		padding: 3px 10px;
		border-radius: 999px;
		cursor: pointer;
		font-size: 11px;
		font-family: inherit;
	}
	.renderer-pill:hover {
		color: var(--color-text);
	}
	.renderer-pill.active {
		background: var(--color-accent);
		color: #1a1a1a;
		font-weight: 600;
	}
</style>
