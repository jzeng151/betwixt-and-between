// Imperative Leaflet helpers extracted from WorldMap.svelte. Kept as pure
// functions (no Svelte runes) so MapStage / RegionLayer / PlacementLayer can
// stay focused on their bind: handles and let the popup-event wiring live
// in one place. Behavior is identical to the original inline wiring; see
// `wirePopupHandlers` for the exact button selectors.

export type PopupCallbacks = {
	onEditRegion: (regionId: string) => void;
	onDeleteRegion: (regionId: string) => void;
	onDrillIntoLocation: (locationId: string) => boolean;
	onCreateMapOffer: (offer: { childId: string; childName: string }) => void;
	onOpenEntity: (entityId: string) => void;
	onDeletePlacement: (placementId: string) => void;
	getChildEntityName: (entityId: string) => string | null;
};

// Wire up the click delegates on a freshly-opened Leaflet popup. Called from
// MapStage's `popupopen` listener; the popup element is the live DOM node
// Leaflet just inserted. Each button is data-attribute-tagged in the popup
// HTML (see region-popup.ts + the placement popup template in PlacementLayer).
export function wirePopupHandlers(
	popupEl: HTMLElement,
	closePopup: () => void,
	cb: PopupCallbacks
): void {
	const editBtn = popupEl.querySelector('[data-action="edit"]');
	const deleteBtn = popupEl.querySelector('[data-action="delete"]');
	const drillBtn = popupEl.querySelector('[data-action="drill"]');
	const nameEl = popupEl.querySelector('.region-popup-name');
	const openEntityBtn = popupEl.querySelector('[data-action="open-entity"]');
	const deletePlacementBtn = popupEl.querySelector('[data-action="delete-placement"]');

	if (editBtn) {
		editBtn.addEventListener('click', () => {
			cb.onEditRegion((editBtn as HTMLElement).dataset.regionId!);
			closePopup();
		});
	}
	if (deleteBtn) {
		deleteBtn.addEventListener('click', () => {
			cb.onDeleteRegion((deleteBtn as HTMLElement).dataset.regionId!);
			closePopup();
		});
	}
	if (drillBtn) {
		drillBtn.addEventListener('click', () => {
			const childId = (drillBtn as HTMLElement).dataset.locationId;
			if (!childId) return;
			closePopup();
			if (!cb.onDrillIntoLocation(childId)) {
				const name = cb.getChildEntityName(childId);
				if (name !== null) cb.onCreateMapOffer({ childId, childName: name });
			}
		});
	}
	if (nameEl) {
		nameEl.addEventListener('click', () => {
			const locId = (nameEl as HTMLElement).dataset.locationId;
			if (locId) cb.onOpenEntity(locId);
			closePopup();
		});
	}
	if (openEntityBtn) {
		openEntityBtn.addEventListener('click', () => {
			const id = (openEntityBtn as HTMLElement).dataset.entityId;
			if (id) cb.onOpenEntity(id);
			closePopup();
		});
	}
	if (deletePlacementBtn) {
		deletePlacementBtn.addEventListener('click', () => {
			const id = (deletePlacementBtn as HTMLElement).dataset.placementId;
			if (id) cb.onDeletePlacement(id);
			closePopup();
		});
	}
}
