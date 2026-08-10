// Cinematic Spotlight (Slice 8) — within-map camera director (pure core).
//
// The within-map camera should drift to whatever CHANGED this frame — the
// flipped regions and the moving markers — so playback reads like a camera
// following the action. This module computes the camera TARGET (center + zoom)
// from that changed geometry; the integration eases the live pixi-viewport
// toward it componentwise (centerX / centerY / zoom) and pins (suspends) on
// user interaction.
// Keeping the target math pure makes it unit-testable without pixi-viewport.
//
// Coordinate space: world pixels — the same space pixi-viewport pans/zooms in
// and PixiRegionLayer draws in (region polygons flattened as [lng, lat] = [x, y]
// source-image px; markers at fractional×mapDims px). The CALLER supplies region
// polygons already transposed to [x, y] world order (it already does this for
// causalInput) and mover positions in world px, so this module is free of the
// Leaflet [lat, lng] convention.
//
// `zoom` matches pixi-viewport's setZoom scale: worldUnits × zoom = screenPx.
//
// Window/Pixi-free (SSR-safe, unit-tested).

export type Pt = { x: number; y: number };

export type CameraTarget = {
	centerX: number;
	centerY: number;
	zoom: number;
};

export function coverRect(
	from: { width: number; height: number },
	to: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
	const scale = Math.max(to.width / from.width, to.height / from.height);
	const width = from.width * scale;
	const height = from.height * scale;
	return { x: (to.width - width) / 2, y: (to.height - height) / 2, width, height };
}

export function remapCameraAcrossMaps(
	current: CameraTarget,
	from: { width: number; height: number },
	to: { width: number; height: number }
): CameraTarget {
	return {
		centerX: clamp(current.centerX / from.width, 0, 1) * to.width,
		centerY: clamp(current.centerY / from.height, 0, 1) * to.height,
		zoom: Number.isFinite(current.zoom) && current.zoom > 0 ? current.zoom : 1
	};
}

export type CameraOptions = {
	// Margin left around the changed bbox, as a fraction of the screen (0.2 = fit
	// the bbox into the middle 80%). Gives the action breathing room.
	paddingFrac?: number;
	// Zoom clamp (pixi-viewport scale units). Stops a tiny single region from
	// zooming to a pixel, or a huge one from zooming past the source resolution.
	minZoom?: number;
	maxZoom?: number;
	// Zoom used when the changed geometry is a single point / zero-area (one
	// marker, or a degenerate region) — there's no extent to fit, so focus at a
	// readable zoom instead. Defaults to maxZoom.
	pointZoom?: number;
	// Current framing lets the director hold when all action remains inside the
	// central comfort zone instead of recentering every beat.
	current?: CameraTarget;
	comfortFrac?: number;
};

const DEFAULTS = {
	paddingFrac: 0.2,
	minZoom: 0.25,
	maxZoom: 2,
	pointZoom: 2
} as const;

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

export function cameraTauMs(secondsPerScene: number): number {
	return clamp(secondsPerScene * 120, 60, 400);
}

export function cameraTargetSettled(current: CameraTarget, target: CameraTarget): boolean {
	const zoom = Math.max(0.25, current.zoom);
	return (
		Math.abs(current.zoom - target.zoom) <= 0.001 &&
		Math.hypot(current.centerX - target.centerX, current.centerY - target.centerY) * zoom <= 0.5
	);
}

/**
 * Compute the camera target framing the changed-this-frame geometry, or null to
 * HOLD (nothing changed → don't move the camera). Pure.
 *
 *   - `changedRegionPolys`: polygons of the regions that changed this frame,
 *     each `[[x, y], …]` in world px. Empty / malformed polygons are ignored.
 *   - `moverPositions`: interpolated marker positions (world px) to keep framed.
 *   - `screen`: the canvas size in px, for zoom-to-fit (worldUnits × zoom = px).
 *
 * Returns null when there is nothing to frame (no changed regions, no movers) —
 * the caller leaves the viewport where it is. A single point (one marker or a
 * degenerate region) frames at `pointZoom` since it has no extent to fit.
 */
export function computeCameraTarget(
	changedRegionPolys: number[][][],
	moverPositions: Pt[],
	screen: { width: number; height: number },
	opts: CameraOptions = {}
): CameraTarget | null {
	const paddingFrac = opts.paddingFrac ?? DEFAULTS.paddingFrac;
	const minZoom = opts.minZoom ?? DEFAULTS.minZoom;
	const maxZoom = opts.maxZoom ?? DEFAULTS.maxZoom;
	const pointZoom = opts.pointZoom ?? opts.current?.zoom ?? DEFAULTS.pointZoom;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let any = false;

	const consider = (x: number, y: number): void => {
		if (!Number.isFinite(x) || !Number.isFinite(y)) return;
		any = true;
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	};

	for (const poly of changedRegionPolys) {
		if (!Array.isArray(poly)) continue;
		for (const v of poly) {
			if (!Array.isArray(v) || v.length < 2) continue;
			consider(v[0], v[1]);
		}
	}
	for (const p of moverPositions) consider(p.x, p.y);

	if (!any) return null; // hold

	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	const bboxW = maxX - minX;
	const bboxH = maxY - minY;
	const current = opts.current;
	if (current && current.zoom > 0) {
		const comfortFrac = clamp(opts.comfortFrac ?? 0.65, 0, 1);
		const halfW = (screen.width / current.zoom / 2) * comfortFrac;
		const halfH = (screen.height / current.zoom / 2) * comfortFrac;
		if (
			minX >= current.centerX - halfW &&
			maxX <= current.centerX + halfW &&
			minY >= current.centerY - halfH &&
			maxY <= current.centerY + halfH
		) {
			return null;
		}
	}

	// Degenerate extent (single point / zero-area) → focus at pointZoom.
	if (bboxW <= 0 && bboxH <= 0) {
		return {
			centerX,
			centerY,
			zoom: clamp(pointZoom, minZoom, Math.max(maxZoom, current?.zoom ?? maxZoom))
		};
	}

	// Zoom-to-fit with padding: the bbox should occupy (1 - paddingFrac) of the
	// screen on its tighter axis. Guard a zero-width-or-height bbox (a horizontal
	// or vertical line) by only constraining the non-degenerate axis.
	const usableW = screen.width * (1 - paddingFrac);
	const usableH = screen.height * (1 - paddingFrac);
	const fitX = bboxW > 0 ? usableW / bboxW : Infinity;
	const fitY = bboxH > 0 ? usableH / bboxH : Infinity;
	const zoom = clamp(Math.min(fitX, fitY), minZoom, maxZoom);

	return { centerX, centerY, zoom };
}
