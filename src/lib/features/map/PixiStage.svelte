<script lang="ts">
	// PixiStage — stub for Slice 1b PR 2 commit 1.
	//
	// Commit 2 replaces this with svelte-pixi's <Application> mounted via
	// dynamic import inside onMount (mirrors MapStage's Leaflet pattern,
	// keeps Pixi out of the SSR/Worker bundle). The stub ships first so
	// the `?renderer=` flag branch is end-to-end testable before any
	// canvas wiring lands.
</script>

<div class="pixi-stub">
	<p class="stub-title">Pixi renderer coming online</p>
	<p class="stub-hint">
		Slice 1b PR 2 work-in-progress. Append <code>?renderer=leaflet</code> to the URL
		to switch back to the shipped renderer.
	</p>
</div>

<style>
	.pixi-stub {
		flex: 1;
		width: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: var(--color-surface);
		color: var(--color-text-muted);
		padding: 24px;
	}
	.stub-title {
		font-size: 15px;
		margin: 0;
	}
	.stub-hint {
		font-size: 12px;
		margin: 0;
		text-align: center;
		max-width: 360px;
	}
	.stub-hint code {
		background: var(--color-bg);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: monospace;
		color: var(--color-accent);
	}
</style>
