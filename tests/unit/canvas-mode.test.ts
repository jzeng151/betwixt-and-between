// Slice 4 T7 — canvas interaction-mode arbitration.
//
// The world-map canvas must be in exactly one interaction mode at a time so a
// pointer gesture can't be claimed by two consumers (the class of bug the
// prior P2 fixes patched: marker taps while brushing, paint strokes on polygon
// vertices). computeCanvasMode is the single source of truth; these tests pin
// the priority cascade and the exclusivity invariant.

import { describe, it, expect } from 'vitest';
import { computeCanvasMode } from '../../src/lib/features/map/canvas-mode.js';

describe('computeCanvasMode', () => {
	it('is idle when nothing is active', () => {
		expect(computeCanvasMode({ drawing: false, brushing: false, armed: false })).toBe('idle');
	});

	it('maps each single active flag to its mode', () => {
		expect(computeCanvasMode({ drawing: true, brushing: false, armed: false })).toBe('draw');
		expect(computeCanvasMode({ drawing: false, brushing: true, armed: false })).toBe('brush');
		expect(computeCanvasMode({ drawing: false, brushing: false, armed: true })).toBe('place-armed');
	});

	it('draw wins over brush and place-armed (pointer ownership precedence)', () => {
		expect(computeCanvasMode({ drawing: true, brushing: true, armed: true })).toBe('draw');
		expect(computeCanvasMode({ drawing: true, brushing: false, armed: true })).toBe('draw');
	});

	it('brush wins over place-armed', () => {
		expect(computeCanvasMode({ drawing: false, brushing: true, armed: true })).toBe('brush');
	});

	it('exclusivity: every combination resolves to exactly one mode', () => {
		const valid = new Set(['idle', 'draw', 'brush', 'place-armed']);
		for (const drawing of [false, true]) {
			for (const brushing of [false, true]) {
				for (const armed of [false, true]) {
					const mode = computeCanvasMode({ drawing, brushing, armed });
					expect(valid.has(mode)).toBe(true);
				}
			}
		}
	});
});
