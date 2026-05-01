/**
 * Pure viewport-edge clamping math for ContextMenu. Extracted from the
 * component so it can be unit-tested without a DOM.
 *
 * Given a desired top-left anchor (x, y) and the menu's measured width
 * and height, return the adjusted (x, y) such that the menu fits inside
 * the viewport. If the menu would overflow the right or bottom edge,
 * shift it left/up. If the menu is wider/taller than the viewport, the
 * left/top edge wins (clamp to 0) — better to show the start than the
 * end of the list.
 */
export function clampToViewport(
	x: number,
	y: number,
	menuWidth: number,
	menuHeight: number,
	viewportWidth: number,
	viewportHeight: number
): { x: number; y: number } {
	let nx = x;
	let ny = y;
	if (nx + menuWidth > viewportWidth) nx = viewportWidth - menuWidth;
	if (ny + menuHeight > viewportHeight) ny = viewportHeight - menuHeight;
	if (nx < 0) nx = 0;
	if (ny < 0) ny = 0;
	return { x: nx, y: ny };
}
