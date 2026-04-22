import { test, expect } from '@playwright/test';

test.use({
	storageState: { cookies: [], origins: [] }
});

test.describe('Window Manager', () => {
	test.beforeEach(async ({ page }) => {
		// Skip tutorial overlay on every test
		await page.addInitScript(() => {
			localStorage.setItem('tutorial-dismissed', 'true');
		});
		await page.goto('/');
	});

	test('open window → appears on screen', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Character"]');
		await expect(win).toBeVisible();
	});

	test('click taskbar button → window comes to front (z-index check)', async ({ page }) => {
		// Open two windows; Timeline (last opened) gets the higher z-index initially
		await page.click('button[title="Characters"]');
		await page.click('button[title="Timeline"]');

		const charactersWin = page.locator('.window[aria-label="Character"]');
		const timelineWin = page.locator('.window[aria-label="Timeline"]');

		// Timeline was opened last — it should be on top
		const charZ = await charactersWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		const timeZ = await timelineWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		expect(timeZ).toBeGreaterThan(charZ);

		// Minimize Characters via its taskbar button (visible + single → minimizes)
		await page.click('button[title="Characters"]');
		await expect(charactersWin).not.toBeVisible();

		// Click Characters taskbar button again (minimized → restore/focus → comes to front)
		await page.click('button[title="Characters"]');
		await expect(charactersWin).toBeVisible();
		const charZ2 = await charactersWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		const timeZ2 = await timelineWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		expect(charZ2).toBeGreaterThan(timeZ2);
	});

	test('drag window → position updates', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Character"]');
		await expect(win).toBeVisible();

		const box = await win.boundingBox();
		expect(box).not.toBeNull();

		const titlebar = win.locator('.titlebar');
		const tbBox = await titlebar.boundingBox();
		expect(tbBox).not.toBeNull();

		const startX = tbBox!.x + tbBox!.width / 2;
		const startY = tbBox!.y + tbBox!.height / 2;
		const deltaX = 150;
		const deltaY = 80;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 10 });
		await page.mouse.up();

		const newBox = await win.boundingBox();
		expect(newBox!.x).toBeCloseTo(box!.x + deltaX, -1);
		expect(newBox!.y).toBeCloseTo(box!.y + deltaY, -1);
	});

	test('minimize → window hidden, taskbar button still present', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Character"]');
		await expect(win).toBeVisible();

		// Click minimize button
		await win.locator('button[aria-label="Minimize"]').click();
		await expect(win).not.toBeVisible();

		// Taskbar button still present with active dot (window is open but minimized)
		const taskbarBtn = page.locator('button[title="Characters"]');
		await expect(taskbarBtn).toBeVisible();
		await expect(taskbarBtn.locator('.active-dot')).toBeVisible();
	});
});
