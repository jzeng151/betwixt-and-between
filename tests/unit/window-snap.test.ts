import { describe, expect, it } from 'vitest';
import { snapBounds, snapZone, type SnapZone } from '../../src/lib/os/window-snap.js';

describe('window snap geometry', () => {
	it.each([
		[0, 300, 'left', { x: 0, y: 0, width: 640, height: 677 }],
		[1280, 300, 'right', { x: 640, y: 0, width: 641, height: 677 }],
		[60, 0, 'top-left', { x: 0, y: 0, width: 640, height: 338 }],
		[1280, 60, 'top-right', { x: 640, y: 0, width: 641, height: 338 }],
		[0, 720, 'bottom-left', { x: 0, y: 338, width: 640, height: 339 }],
		[1250, 676, 'bottom-right', { x: 640, y: 338, width: 641, height: 339 }]
	] as const)('maps pointer %s,%s to %s without gaps', (x, y, zone, bounds) => {
		expect(snapZone(x, y, 1281, 677)).toBe(zone);
		expect(snapBounds(zone as SnapZone, 1281, 677, 280, 200)).toEqual(bounds);
	});
	it('leaves the center alone and rejects layouts smaller than the window minimum', () => {
		expect(snapZone(640, 300, 1280, 676)).toBeNull();
		expect(snapZone(640, 0, 1280, 676)).toBeNull();
		expect(snapBounds('top-left', 1280, 350, 280, 200)).toBeNull();
		expect(snapBounds('left', 500, 700, 280, 200)).toBeNull();
		expect(snapBounds('top-left', 1280, 350, 240, 88)?.height).toBe(175);
	});
});
