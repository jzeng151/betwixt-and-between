// Region popup HTML and the shared HTML-escape used wherever user-supplied
// strings get interpolated into Leaflet popup template strings. Self-XSS is
// contained by the per-user auth gate today, but escaping closes the surface
// uniformly. Extracted from WorldMap.svelte; pure functions only.

import type { Entity } from '$lib/stores/entities.js';
import type { MapRegion, WorldMap } from './types.js';
import { resolveActiveVariant } from './variants.js';

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export type RegionPopupContext = {
	activeMapLocationId: string | null | undefined;
	entities: Entity[];
	worldMaps: WorldMap[];
	playhead: number | null;
};

export function buildRegionPopup(
	region: MapRegion,
	locName: string | null,
	ctx: RegionPopupContext
): string {
	const locHtml = locName && region.locationId
		? `<button class="region-popup-name" data-location-id="${region.locationId}">${escapeHtml(locName)}</button>`
		: '<span class="region-popup-name">Unlinked region</span>';

	// Drill-down: clicking the region's linked Location should descend into
	// that Location's own map (one level deeper than the current map). If
	// the Location has no map yet, surface the "Create map for X" CTA.
	// Skip the affordance when the region links to the current map's
	// anchor Location (drilling would be a no-op).
	let drillHtml = '';
	if (region.locationId && region.locationId !== ctx.activeMapLocationId) {
		const loc = ctx.entities.find((e) => e.id === region.locationId);
		if (loc) {
			const locVariant = resolveActiveVariant(ctx.worldMaps, region.locationId, ctx.playhead);
			const verb = locVariant ? 'Zoom in to' : 'Create map for';
			drillHtml = `<button class="region-popup-btn region-popup-btn-drill" data-action="drill" data-location-id="${region.locationId}">${verb} ${escapeHtml(loc.name)}</button>`;
		}
	}

	return `<div class="region-popup">${locHtml}${drillHtml}<div class="region-popup-actions"><button class="region-popup-btn" data-action="edit" data-region-id="${region.id}">Edit</button><button class="region-popup-btn region-popup-btn-danger" data-action="delete" data-region-id="${region.id}">Delete</button></div></div>`;
}
