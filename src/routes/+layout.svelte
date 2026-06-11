<script lang="ts">
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { preferences } from '$lib/os/preferences-store.js';
	import { applyPaletteVars, serializePaletteCookie } from '$lib/palette-vars.js';
	import {
		hydratePreferences,
		preferencesUserId,
		preferencesOwnershipResolved
	} from '$lib/os/preferences-sync.js';
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
		const ownerId = $preferencesUserId;
		// Ownership not resolved yet → don't apply/mirror a possibly-foreign cache;
		// the owner-scoped SSR inline holds the first paint. This stays closed through
		// a transient hydrate failure (unlike a plain "attempted" flag), so a failed
		// GET on a shared browser can't flash another user's palette before the retry
		// resolves it (codex). Re-runs when ownership resolves / appearance changes.
		if (!$preferencesOwnershipResolved) return;
		if (typeof document !== 'undefined') {
			if (appearance.theme === 'light') {
				document.documentElement.setAttribute('data-theme', 'light');
			} else {
				document.documentElement.removeAttribute('data-theme');
			}
		}
		applyPaletteVars(appearance);
		// Drop the SSR-inlined override block now that applyPaletteVars has set the
		// live inline custom-properties (which out-rank it). No flash — the inline
		// props already carry the colors — and it stops a later in-session reset
		// from cascading back to the stale cookie value instead of the app.css
		// default. Idempotent: getElementById returns null after the first removal.
		if (typeof document !== 'undefined') {
			document.getElementById('palette-ssr')?.remove();
		}
		// Mirror the resolved palette to a cookie so the server hook can inline
		// it for a no-flash first paint on the next navigation/reload (T5b 3C/6A).
		if (typeof document !== 'undefined') {
			// Stamp the signed-in user so the SSR hook scopes this cookie to the
			// current account (codex P1, SSR half). $preferencesUserId re-fires this
			// effect when it resolves post-hydrate, replacing any pre-hydrate value.
			const value = encodeURIComponent(serializePaletteCookie(appearance, ownerId));
			// `secure` only on an https origin: browsers drop Secure cookies on http,
			// which silently breaks the SSR anti-FOUC palette. Gate on the page's
			// actual protocol rather than the DEV build flag — a production build
			// served over http (`npm run preview`, http staging/LAN) is !DEV but still
			// needs the cookie to persist for the next SSR.
			const secure = location.protocol === 'https:' ? '; secure' : '';
			document.cookie = `${PALETTE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${secure}`;
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
