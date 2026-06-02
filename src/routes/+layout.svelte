<script lang="ts">
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { preferences } from '$lib/os/preferences-store.js';
	import { applyPaletteVars, serializePaletteCookie } from '$lib/palette-vars.js';
	import { hydratePreferences } from '$lib/os/preferences-sync.js';
	import { PALETTE_COOKIE } from '$lib/palette-cookie.js';

	let { children } = $props();

	// Activate server sync on app load: pull the user's saved preferences from
	// /api/preferences (401 → anonymous, localStorage-only). This is what makes
	// applyPreferencePatch (Settings) persist server-side + follow across devices.
	onMount(() => {
		void hydratePreferences();
	});

	// Apply theme + the user's color overrides globally whenever appearance
	// changes (Settings customization T5/T6). $effect is client-only, so SSR is
	// unaffected (no-flash SSR is T5b 3C). Consumers that read
	// var(--color-type/rel/role-*) — graph, wiki, palette, role badges — recolor
	// for free; a reset removes the var → app.css default.
	$effect(() => {
		const appearance = $preferences.appearance;
		if (typeof document !== 'undefined') {
			if (appearance.theme === 'light') {
				document.documentElement.setAttribute('data-theme', 'light');
			} else {
				document.documentElement.removeAttribute('data-theme');
			}
		}
		applyPaletteVars(appearance);
		// Mirror the resolved palette to a cookie so the server hook can inline
		// it for a no-flash first paint on the next navigation/reload (T5b 3C/6A).
		if (typeof document !== 'undefined') {
			const value = encodeURIComponent(serializePaletteCookie(appearance));
			document.cookie = `${PALETTE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
		}
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<!-- Chrome still probes /favicon.ico even with an SVG icon declared; this
	     empty alternate suppresses the 404. -->
	<link rel="alternate icon" type="image/x-icon" href="data:," />
</svelte:head>

{@render children()}
