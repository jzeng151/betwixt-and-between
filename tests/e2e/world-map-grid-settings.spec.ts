import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

test.beforeEach(async ({ page, request }) => {
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const map of maps) await request.delete(`/api/maps/${map.id}`);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
});

async function createMap(request: APIRequestContext, name: string) {
	const map = await (await request.post('/api/maps', { data: { name } })).json();
	expect((await request.patch(`/api/maps/${map.id}`, { data: { width: 640, height: 480 } })).ok()).toBe(true);
	return map;
}

test('grid settings validate, save, cancel, and persist independently for each map', async ({ page, request }) => {
	const first = await createMap(request, 'Northern coast');
	const second = await createMap(request, 'Southern coast');
	await page.goto('/app');
	await page.getByTitle('World Map', { exact: true }).click();
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.locator('.map-switcher').selectOption(first.id);
	const gridButton = win.getByRole('button', { name: 'Grid', exact: true });
	await gridButton.click();
	const panel = win.getByRole('dialog', { name: 'Map grid settings' });
	await expect(panel.getByLabel('Layout')).toBeFocused();
	await panel.getByLabel('Layout').selectOption('hex');
	await panel.getByLabel('Columns').fill('48');
	await panel.getByLabel('Rows', { exact: true }).fill('32');
	await panel.getByLabel('Units per cell').fill('0');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel).toBeVisible();
	expect(await panel.getByLabel('Units per cell').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
	await panel.getByLabel('Units per cell').fill('2.5');
	await panel.getByLabel('Unit', { exact: true }).fill('km');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel).toHaveCount(0);
	await expect(gridButton).toBeFocused();
	expect(await (await request.get(`/api/maps/${first.id}`)).json()).toMatchObject({ gridType: 'hex', gridCellsX: 48, gridCellsY: 32, gridScaleValue: 2.5, gridScaleUnit: 'km' });

	await page.reload();
	await win.locator('.map-switcher').selectOption(first.id);
	await gridButton.click();
	await expect(panel.getByLabel('Layout')).toHaveValue('hex');
	await expect(panel.getByLabel('Columns')).toHaveValue('48');
	await expect(panel.getByLabel('Unit', { exact: true })).toHaveValue('km');
	await panel.getByLabel('Columns').fill('64');
	await panel.getByLabel('Columns').press('Escape');
	await expect(panel).toHaveCount(0);
	await gridButton.click();
	await expect(panel.getByLabel('Columns')).toHaveValue('48');
	await win.locator('.map-switcher').selectOption(second.id);
	await expect(panel).toHaveCount(0);
	await gridButton.click();
	await expect(panel.getByLabel('Layout')).toHaveValue('square');
	await expect(panel.getByLabel('Unit', { exact: true })).toHaveValue('m');
	await panel.getByRole('button', { name: 'Cancel' }).click();
});

test('terrain conflicts preserve the draft and allow a safe retry', async ({ page, request }) => {
	const map = await createMap(request, 'Painted coast');
	const paint = await request.post(`/api/maps/${map.id}/events`, { data: {
		tPosition: 0, kind: 'paint_cells', payloadJsonb: { cells: [{ x: 20, y: 10, biome: 'water_grass' }] }
	} });
	expect(paint.ok()).toBe(true);
	await page.goto('/app');
	await page.getByTitle('World Map', { exact: true }).click();
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.getByRole('button', { name: 'Grid', exact: true }).click();
	const panel = win.getByRole('dialog', { name: 'Map grid settings' });
	await panel.getByLabel('Layout').selectOption('hex');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel.getByRole('alert')).toContainText('including earlier story times');
	await expect(panel.getByLabel('Layout')).toHaveValue('hex');
	await panel.getByLabel('Layout').selectOption('square');
	await panel.getByLabel('Columns').fill('4');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel.getByRole('alert')).toContainText('Cannot shrink');
	expect(await (await request.get(`/api/maps/${map.id}`)).json()).toMatchObject({ gridType: 'square', gridCellsX: 32 });
	await panel.getByLabel('Columns').fill('40');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel).toHaveCount(0);
	expect(await (await request.get(`/api/maps/${map.id}`)).json()).toMatchObject({ gridCellsX: 40 });
});


test('a save finishing after a map switch cannot close or overwrite the new draft', async ({ page, request }) => {
	const first = await createMap(request, 'First map');
	const second = await createMap(request, 'Second map');
	await page.goto('/app');
	await page.getByTitle('World Map', { exact: true }).click();
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.locator('.map-switcher').selectOption(first.id);
	let release!: () => void;
	let started!: () => void;
	const hold = new Promise<void>((resolve) => { release = resolve; });
	const saving = new Promise<void>((resolve) => { started = resolve; });
	await page.route(`**/api/maps/${first.id}`, async (route) => {
		if (route.request().method() !== 'PATCH') return route.continue();
		const response = await route.fetch();
		started();
		await hold;
		await route.fulfill({ response });
	});
	try {
		await win.getByRole('button', { name: 'Grid', exact: true }).click();
		const panel = win.getByRole('dialog', { name: 'Map grid settings' });
		await panel.getByLabel('Columns').fill('64');
		await panel.getByRole('button', { name: 'Save grid' }).click();
		await saving;
		await expect(panel.getByLabel('Columns')).toBeDisabled();
		await win.locator('.map-switcher').selectOption(second.id);
		await expect(panel).toHaveCount(0);
		await win.getByRole('button', { name: 'Grid', exact: true }).click();
		await panel.getByLabel('Columns').fill('48');
		const finished = page.waitForResponse((response) => response.url().endsWith(`/api/maps/${first.id}`) && response.request().method() === 'PATCH');
		release();
		await finished;
		await expect(panel.getByLabel('Columns')).toHaveValue('48');
		await panel.getByRole('button', { name: 'Save grid' }).click();
		await expect(panel).toHaveCount(0);
		expect(await (await request.get(`/api/maps/${first.id}`)).json()).toMatchObject({ gridCellsX: 64 });
		expect(await (await request.get(`/api/maps/${second.id}`)).json()).toMatchObject({ gridCellsX: 48 });
	} finally { release(); }
});
