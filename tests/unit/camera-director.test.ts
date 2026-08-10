// Cinematic Spotlight (Slice 8) — camera-director target math. The pixi-viewport
// ease is canvas-only; this pins the pure framing the integration eases toward.

import { describe, it, expect } from 'vitest';
import {
	computeCameraTarget,
	coverRect,
	remapCameraAcrossMaps
} from '../../src/lib/features/map/camera-director.js';

const SCREEN = { width: 800, height: 600 };

// A square region [x0,y0]..[x1,y1] as a 4-vertex polygon in world [x,y] order.
function square(x0: number, y0: number, x1: number, y1: number): number[][] {
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1]
	];
}

describe('computeCameraTarget — hold', () => {
	it('returns null when nothing changed (no regions, no movers)', () => {
		expect(computeCameraTarget([], [], SCREEN)).toBeNull();
	});

	it('returns null when changed polygons are all empty/malformed', () => {
		expect(computeCameraTarget([[], [[1]]], [], SCREEN)).toBeNull();
	});
});

it('preserves normalized framing across maps with different dimensions', () => {
	expect(
		remapCameraAcrossMaps(
			{ centerX: 750, centerY: 100, zoom: 1.5 },
			{ width: 1000, height: 500 },
			{ width: 400, height: 800 }
		)
	).toEqual({ centerX: 300, centerY: 160, zoom: 1.5 });
});

it('covers a new aspect ratio without stretching the captured frame', () => {
	expect(coverRect({ width: 800, height: 400 }, { width: 400, height: 800 })).toEqual({
		x: -600,
		y: 0,
		width: 1600,
		height: 800
	});
});

describe('computeCameraTarget — centering', () => {
	it('centers on a single changed region bbox', () => {
		const t = computeCameraTarget([square(100, 100, 300, 200)], [], SCREEN);
		expect(t).not.toBeNull();
		expect(t!.centerX).toBe(200);
		expect(t!.centerY).toBe(150);
	});

	it('frames the union of multiple changed regions and movers', () => {
		const t = computeCameraTarget(
			[square(0, 0, 100, 100)],
			[{ x: 400, y: 300 }],
			SCREEN
		);
		// bbox = [0,0]..[400,300] → center (200,150)
		expect(t!.centerX).toBe(200);
		expect(t!.centerY).toBe(150);
	});

	it('ignores non-finite mover coords', () => {
		const t = computeCameraTarget(
			[square(0, 0, 100, 100)],
			[{ x: NaN, y: 5 }],
			SCREEN
		);
		expect(t!.centerX).toBe(50);
		expect(t!.centerY).toBe(50);
	});
});

describe('computeCameraTarget — zoom', () => {
	it('zooms to fit the bbox with padding (tighter axis governs)', () => {
		// bbox 200×100; usable 640×480 → fitX=3.2, fitY=4.8 → min 3.2, clamped to 2.
		const t = computeCameraTarget([square(0, 0, 200, 100)], [], SCREEN);
		expect(t!.zoom).toBe(2); // hits maxZoom clamp
	});

	it('respects a higher maxZoom so the fit value shows through', () => {
		const t = computeCameraTarget([square(0, 0, 200, 100)], [], SCREEN, { maxZoom: 5 });
		// fitX = (800*0.8)/200 = 3.2; fitY = (600*0.8)/100 = 4.8 → min 3.2
		expect(t!.zoom).toBeCloseTo(3.2, 6);
	});

	it('zooms OUT (below 1) for a bbox larger than the screen, clamped to minZoom', () => {
		const t = computeCameraTarget([square(0, 0, 8000, 6000)], [], SCREEN, { minZoom: 0.1 });
		// fit = (800*0.8)/8000 = 0.08 → clamped to 0.1
		expect(t!.zoom).toBe(0.1);
	});

	it('focuses a single point (one mover) at pointZoom, not Infinity', () => {
		const t = computeCameraTarget([], [{ x: 250, y: 250 }], SCREEN, { pointZoom: 1.5 });
		expect(t).toEqual({ centerX: 250, centerY: 250, zoom: 1.5 });
	});

	it('handles a zero-height bbox (a horizontal line of movers) via the x axis only', () => {
		const t = computeCameraTarget([], [
			{ x: 0, y: 100 },
			{ x: 200, y: 100 }
		], SCREEN, { maxZoom: 10 });
		// bboxH=0 → fitY=Infinity; fitX=(640)/200=3.2 → zoom 3.2
		expect(t!.centerX).toBe(100);
		expect(t!.zoom).toBeCloseTo(3.2, 6);
	});
});
