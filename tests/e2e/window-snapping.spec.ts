import { test, expect, type Page, type Locator } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1280, height: 720 } });
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.getByTitle('Characters', { exact: true }).click();
});

async function dragTo(page: Page, win: Locator, x: number, y: number) {
	const title = (await win.locator('.titlebar').boundingBox())!;
	await page.mouse.move(title.x + 60, title.y + title.height / 2);
	await page.mouse.down();
	await page.mouse.move(x, y, { steps: 10 });
}

test('edge and corner previews commit halves and quarters above the taskbar', async ({ page }) => {
	const win = page.getByRole('dialog', { name: 'Characters', exact: true });
	const original = (await win.boundingBox())!;
	for (const [x, y, expected] of [
		[1, 300, { x: 0, y: 0, width: 640, height: 676 }],
		[1279, 300, { x: 640, y: 0, width: 640, height: 676 }],
		[1, 1, { x: 0, y: 0, width: 640, height: 338 }],
		[1279, 1, { x: 640, y: 0, width: 640, height: 338 }],
		[1, 719, { x: 0, y: 338, width: 640, height: 338 }],
		[1279, 719, { x: 640, y: 338, width: 640, height: 338 }]
	] as const) {
		await dragTo(page, win, x, y);
		await expect(page.locator('.snap-preview')).toBeVisible();
		expect(await page.locator('.snap-preview').boundingBox()).toEqual(expected);
		await page.mouse.up();
		expect(await win.boundingBox()).toEqual(expected);
		await expect(page.locator('.snap-preview')).toHaveCount(0);
	}
	await dragTo(page, win, 400, 220);
	await page.mouse.up();
	const restored = (await win.boundingBox())!;
	expect(restored.width).toBe(original.width);
	expect(restored.height).toBe(original.height);
});

test('leaving a zone or pressing Escape cancels the preview', async ({ page }) => {
	const win = page.getByRole('dialog', { name: 'Characters', exact: true });
	const original = (await win.boundingBox())!;
	await dragTo(page, win, 1, 300);
	await page.mouse.move(400, 200);
	await expect(page.locator('.snap-preview')).toHaveCount(0);
	await page.mouse.up();
	expect((await win.boundingBox())!.width).toBe(original.width);
	const moved = await win.boundingBox();
	await dragTo(page, win, 1279, 300);
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('.snap-preview')).toHaveCount(0);
	expect(await win.boundingBox()).toEqual(moved);
});

test('titlebar arrangements restore, maximize, minimize, and survive reload', async ({ page }) => {
	const win = page.getByRole('dialog', { name: 'Characters', exact: true });
	const original = await win.boundingBox();
	const arrange = win.getByRole('combobox', { name: 'Arrange window' });
	await arrange.focus();
	await expect(arrange).toBeFocused();
	await arrange.selectOption('right');
	const snapped = await win.boundingBox();
	await win.getByRole('button', { name: 'Maximize', exact: true }).click();
	await expect(arrange).toBeDisabled();
	await win.getByRole('button', { name: 'Restore', exact: true }).click();
	expect(await win.boundingBox()).toEqual(snapped);
	await arrange.selectOption('restore');
	expect(await win.boundingBox()).toEqual(original);
	await arrange.selectOption('bottom-left');
	const quarter = await win.boundingBox();
	await win.getByRole('button', { name: 'Minimize', exact: true }).click();
	await page.getByTitle('Characters', { exact: true }).click();
	expect(await win.boundingBox()).toEqual(quarter);
	await page.reload();
	await expect(win).toBeVisible();
	expect(await win.boundingBox()).toEqual(quarter);
	await arrange.selectOption('restore');
	expect(await win.boundingBox()).toEqual(original);
	await arrange.selectOption('left');
	await page.reload();
	await expect(win).toBeVisible();
	await dragTo(page, win, 400, 220);
	await page.mouse.up();
	const restored = (await win.boundingBox())!;
	expect(restored.width).toBe(original!.width);
	expect(restored.height).toBe(original!.height);
});

test('short viewports disable quarters while keeping halves available', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 400 });
	const win = page.getByRole('dialog', { name: 'Characters', exact: true });
	const arrange = win.getByRole('combobox', { name: 'Arrange window' });
	await expect(arrange.locator('option[value="top-left"]')).toHaveJSProperty('disabled', true);
	await arrange.selectOption('left');
	expect(await win.boundingBox()).toEqual({ x: 0, y: 0, width: 640, height: 356 });
});


test('a viewport resize recalculates the preview without ending the drag', async ({ page }) => {
	const win = page.getByRole('dialog', { name: 'Characters', exact: true });
	await dragTo(page, win, 1, 300);
	await page.setViewportSize({ width: 1400, height: 800 });
	await expect(page.locator('.snap-preview')).toBeVisible();
	expect(await page.locator('.snap-preview').boundingBox()).toEqual({ x: 0, y: 0, width: 700, height: 756 });
	await page.mouse.up();
	expect(await win.boundingBox()).toEqual({ x: 0, y: 0, width: 700, height: 756 });
});
