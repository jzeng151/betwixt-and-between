import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearEntities(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	await Promise.all(ents.map((e) => request.delete(`/api/entities/${e.id}`)));
}

test.describe('Window Manager', () => {
	test.beforeEach(async ({ page, request }) => {
		await clearEntities(request);
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/');
	});

	test('open window → appears on screen', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Characters"]');
		await expect(win).toBeVisible();
	});

	test('click taskbar button → window comes to front (z-index check)', async ({ page }) => {
		// Open two windows; Timeline (last opened) gets the higher z-index initially
		await page.click('button[title="Characters"]');
		await page.click('button[title="Timeline"]');

		const charactersWin = page.locator('.window[aria-label="Characters"]');
		const timelineWin = page.locator('.window[aria-label="Timeline"]');

		// Timeline was opened last — it should be on top
		const charZ = await charactersWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		const timeZ = await timelineWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		expect(timeZ).toBeGreaterThan(charZ);

		// Clicking the taskbar button for the visible+focused Characters window minimizes it
		await page.click('button[title="Characters"]');
		await expect(charactersWin).not.toBeVisible();

		// Clicking again restores and focuses it
		await page.click('button[title="Characters"]');
		await expect(charactersWin).toBeVisible();
		const charZ2 = await charactersWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		const timeZ2 = await timelineWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		expect(charZ2).toBeGreaterThan(timeZ2);
	});

	test('drag window → position updates', async ({ page }) => {
		await page.click('button[title="Characters"]');
		const win = page.locator('.window[aria-label="Characters"]');
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
		const win = page.locator('.window[aria-label="Characters"]');
		await expect(win).toBeVisible();

		await win.locator('button[aria-label="Minimize"]').click();
		await expect(win).not.toBeVisible();

		// Taskbar button still present with active dot (open but minimized)
		const taskbarBtn = page.locator('button[title="Characters"]');
		await expect(taskbarBtn).toBeVisible();
		await expect(taskbarBtn.locator('.active-dot')).toBeVisible();
	});

	test('opening a character detail window puts it on top of the list window', async ({ page, request }) => {
		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
		await page.goto('/'); // reload so store picks up the new entity

		await page.click('button[title="Characters"]');
		const listWin = page.locator('.window[aria-label="Characters"]');
		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });

		// Click the character row — mousedown focuses the list window first,
		// then the click handler opens the detail window with the next z-index
		await listWin.locator('.char-row').first().click();

		const detailWin = page.locator('.window[aria-label="Elara"]');
		await expect(detailWin).toBeVisible({ timeout: 3000 });

		const listZ = await listWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		const detailZ = await detailWin.evaluate((el) => parseInt(getComputedStyle(el).zIndex));
		expect(detailZ).toBeGreaterThan(listZ);
	});
});
