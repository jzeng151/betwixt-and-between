export const SNAP_LABELS = {
	left: 'Left half',
	right: 'Right half',
	'top-left': 'Top left quarter',
	'top-right': 'Top right quarter',
	'bottom-left': 'Bottom left quarter',
	'bottom-right': 'Bottom right quarter'
} as const;

export type SnapZone = keyof typeof SNAP_LABELS;
export type WindowBounds = { x: number; y: number; width: number; height: number };

export function snapZone(x: number, y: number, width: number, height: number): SnapZone | null {
	if (x < 0 || x > width || y < 0) return null;
	const side = x <= 24 ? 'left' : x >= width - 24 ? 'right' : null;
	const cornerSide = x <= 80 ? 'left' : x >= width - 80 ? 'right' : null;
	if (cornerSide && (y <= 24 || (side && y <= 80))) return `top-${cornerSide}`;
	if (cornerSide && (y >= height - 24 || (side && y >= height - 80))) return `bottom-${cornerSide}`;
	return side;
}

export function snapBounds(zone: SnapZone, width: number, height: number, minWidth: number, minHeight: number): WindowBounds | null {
	const right = zone.endsWith('right');
	const bottom = zone.startsWith('bottom');
	const quarter = zone.includes('-');
	const x = right ? Math.floor(width / 2) : 0;
	const y = bottom ? Math.floor(height / 2) : 0;
	const w = right ? width - x : Math.floor(width / 2);
	const h = quarter ? (bottom ? height - y : Math.floor(height / 2)) : height;
	return w >= minWidth && h >= minHeight ? { x, y, width: w, height: h } : null;
}
