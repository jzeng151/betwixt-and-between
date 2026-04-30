import type { Page, Locator } from '@playwright/test';

/**
 * Drive an HTML5 drag-and-drop chain (dragstart → dragenter → dragover →
 * drop → dragend) by dispatching real `DragEvent`s with a shared
 * `DataTransfer`. Playwright's `page.mouse` does NOT synthesize HTML5
 * drag events on Firefox, so any `draggable="true"` flow that relies on
 * `ondragstart` / `ondrop` handlers is untestable without this helper.
 *
 * `from` is the draggable source (the element whose `ondragstart` runs).
 * `target` describes WHERE to drop — either a `Locator` (we use its
 * center) OR an explicit `{ element: Locator, x: number, y: number }`
 * for handlers like the act-resize that branch on `clientX` relative to
 * the target's bounding rect.
 */
export async function html5Drag(
	page: Page,
	from: Locator,
	target: Locator | { element: Locator; x: number; y: number }
): Promise<void> {
	const fromBox = await from.boundingBox();
	if (!fromBox) throw new Error('html5Drag: source has no bounding box');

	const targetEl = 'element' in target ? target.element : target;
	const targetBox = await targetEl.boundingBox();
	if (!targetBox) throw new Error('html5Drag: target has no bounding box');

	const fromX = fromBox.x + fromBox.width / 2;
	const fromY = fromBox.y + fromBox.height / 2;
	const toX = 'x' in target ? target.x : targetBox.x + targetBox.width / 2;
	const toY = 'y' in target ? target.y : targetBox.y + targetBox.height / 2;

	await page.evaluate(
		async ({ fromX, fromY, toX, toY }) => {
			const from = document.elementFromPoint(fromX, fromY) as HTMLElement | null;
			const to = document.elementFromPoint(toX, toY) as HTMLElement | null;
			if (!from) throw new Error('html5Drag: no element at source point');
			if (!to) throw new Error('html5Drag: no element at target point');

			const dataTransfer = new DataTransfer();

			function fire(el: HTMLElement, type: string, x: number, y: number) {
				const ev = new DragEvent(type, {
					bubbles: true,
					cancelable: true,
					composed: true,
					clientX: x,
					clientY: y,
					dataTransfer
				});
				el.dispatchEvent(ev);
			}

			fire(from, 'dragstart', fromX, fromY);
			fire(to, 'dragenter', toX, toY);
			fire(to, 'dragover', toX, toY);
			fire(to, 'drop', toX, toY);
			fire(from, 'dragend', fromX, fromY);
		},
		{ fromX, fromY, toX, toY }
	);
}
