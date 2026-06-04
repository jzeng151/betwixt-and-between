import { describe, it, expect } from 'vitest';
import { squareGridCounts } from '../../src/lib/features/map/grid-dims.js';

// cellW = width/gridCellsX, cellH = height/gridCellsY — these should be ~equal.
const pitch = (w: number, h: number) => {
	const { gridCellsX, gridCellsY } = squareGridCounts(w, h);
	return { cellW: w / gridCellsX, cellH: h / gridCellsY, gridCellsX, gridCellsY };
};

describe('squareGridCounts', () => {
	it('4:3 image reproduces the historical 32×24 default exactly', () => {
		expect(squareGridCounts(640, 480)).toEqual({ gridCellsX: 32, gridCellsY: 24 });
	});

	it('16:9 landscape → square tiles (32×18)', () => {
		expect(squareGridCounts(1920, 1080)).toEqual({ gridCellsX: 32, gridCellsY: 18 });
		const { cellW, cellH } = pitch(1920, 1080);
		expect(cellW).toBe(cellH); // exactly square here
	});

	it('anchors 32 on the longer (vertical) axis for portrait images', () => {
		expect(squareGridCounts(1080, 1920)).toEqual({ gridCellsX: 18, gridCellsY: 32 });
	});

	it('square image → 32×32', () => {
		expect(squareGridCounts(500, 500)).toEqual({ gridCellsX: 32, gridCellsY: 32 });
	});

	it('keeps cells near-square for an awkward aspect (within one cell of rounding)', () => {
		const { cellW, cellH } = pitch(1000, 700); // 10:7, slightly wider than 4:3
		expect(Math.abs(cellW - cellH) / cellW).toBeLessThan(0.05);
	});

	it('clamps degenerate aspects to the 4..128 grid CHECK bound', () => {
		expect(squareGridCounts(3200, 100).gridCellsY).toBe(4);
		expect(squareGridCounts(100, 3200).gridCellsX).toBe(4);
	});

	it('falls back to 32×32 on non-positive dimensions', () => {
		expect(squareGridCounts(0, 480)).toEqual({ gridCellsX: 32, gridCellsY: 32 });
		expect(squareGridCounts(640, -1)).toEqual({ gridCellsX: 32, gridCellsY: 32 });
	});
});
