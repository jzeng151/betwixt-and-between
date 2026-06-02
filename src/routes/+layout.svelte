<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { preferences } from '$lib/os/preferences-store.js';
	import { applyPaletteVars } from '$lib/palette-vars.js';

	let { children } = $props();

	// Live-apply the user's color overrides as --color-* on documentElement
	// whenever appearance changes (Settings customization T5). $effect is
	// client-only, so SSR is unaffected (no-flash SSR is T5b 3C). Consumers that
	// read var(--color-type/rel/role-*) — graph, wiki, palette, role badges —
	// recolor for free. Resetting an override removes the var → app.css default.
	$effect(() => {
		applyPaletteVars($preferences.appearance);
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<!-- Chrome still probes /favicon.ico even with an SVG icon declared; this
	     empty alternate suppresses the 404. -->
	<link rel="alternate icon" type="image/x-icon" href="data:," />
</svelte:head>

{@render children()}
