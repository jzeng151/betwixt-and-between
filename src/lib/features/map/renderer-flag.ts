// World Map v3 Slice 1b — strangler-fig renderer flag.
//
// `?renderer=pixi` swaps WorldMap's canvas from Leaflet to the new
// svelte-pixi stack. Default `leaflet` matches today's behavior. Unknown
// values (`?renderer=foo`) fall through to leaflet silently — the spec
// (design § Slice 2 forward gates) treats invalid values the same as a
// bookmarked URL after the flag is eventually deleted.
//
// Reactivity: `currentRenderer()` reads `$app/state`'s rune-tracked `page`
// object, so callers wrap it in `$derived` and the renderer hot-swaps when
// the URL changes (Δ1b-C: 20× toggle in one tab, no WebGL warnings).

import { page } from '$app/state';

export type Renderer = 'leaflet' | 'pixi';

export const DEFAULT_RENDERER: Renderer = 'leaflet';

export function currentRenderer(): Renderer {
	const raw = page.url.searchParams.get('renderer');
	return raw === 'pixi' ? 'pixi' : 'leaflet';
}
