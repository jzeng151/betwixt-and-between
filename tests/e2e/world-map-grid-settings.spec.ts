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
	const gridButton = win.getByTitle('Grid settings', { exact: true });
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
	await win.getByTitle('Grid settings', { exact: true }).click();
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
		await win.getByTitle('Grid settings', { exact: true }).click();
		const panel = win.getByRole('dialog', { name: 'Map grid settings' });
		await panel.getByLabel('Columns').fill('64');
		await panel.getByRole('button', { name: 'Save grid' }).click();
		await saving;
		await expect(panel.getByLabel('Columns')).toBeDisabled();
		await expect.soft(win.getByRole('button', { name: 'Duplicate map', exact: true })).toBeDisabled();
		await expect.soft(win.getByTitle('Grid settings', { exact: true })).toBeDisabled();
		await win.locator('.map-switcher').selectOption(second.id);
		await win.locator('.map-switcher').selectOption(first.id);
		await expect.soft(win.getByTitle('Grid settings', { exact: true })).toBeDisabled();
		await win.locator('.map-switcher').selectOption(second.id);
		await expect(panel).toHaveCount(0);
		await win.getByTitle('Grid settings', { exact: true }).click();
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


test('grid painting waits until grid settings have finished saving', async ({ page, request }) => {
	const map = await createMap(request, 'Changing grid');
	await page.goto('/app');
	await page.getByTitle('World Map', { exact: true }).click();
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.getByRole('button', { name: 'Maximize', exact: true }).click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible();
	await win.getByTestId('map-tool-selector').getByRole('button', { name: 'Brush', exact: true }).click();
	await expect(win.getByTestId('brush-palette')).toBeVisible();
	let release!: () => void;
	let started!: () => void;
	const hold = new Promise<void>((resolve) => { release = resolve; });
	const saving = new Promise<void>((resolve) => { started = resolve; });
	await page.route(`**/api/maps/${map.id}`, async (route) => {
		if (route.request().method() !== 'PATCH') return route.continue();
		const response = await route.fetch();
		started();
		await hold;
		await route.fulfill({ response });
	});
	try {
		await win.getByTitle('Grid settings', { exact: true }).click();
		const panel = win.getByRole('dialog', { name: 'Map grid settings' });
		await panel.getByLabel('Layout').selectOption('hex');
		await panel.getByRole('button', { name: 'Save grid' }).click();
		await saving;
		const box = await canvas.boundingBox();
		if (!box) throw new Error('Canvas has no bounds');
		const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 };
		await page.mouse.click(point.x, point.y);
		// Let an unintended asynchronous paint request reach the server before checking absence.
		await page.waitForTimeout(200);
		expect.soft((await (await request.get(`/api/maps/${map.id}/events`)).json()).rows).toHaveLength(0);
		release();
		await expect(panel).toHaveCount(0);
		const painted = page.waitForResponse((response) => response.url().endsWith(`/api/maps/${map.id}/events`) && response.request().method() === 'POST');
		await page.mouse.click(point.x, point.y);
		expect((await painted).ok()).toBe(true);
	} finally { release(); }
});

async function restoreMapWindows(page: import('@playwright/test').Page, locationId: string | null, height = 620) {
	await page.addInitScript(({ locationId, height }) => {
		const ids = locationId ? [null, locationId] : [null];
		sessionStorage.setItem('betwixt-windows-v1', JSON.stringify({
			userId: '00000000-0000-0000-0000-00000000e2e0',
			windows: ids.map((entityId, i) => ({ id: entityId ? `world-map-${entityId}` : 'world-map', appId: 'world-map', entityId, x: i * 720, y: 20, width: 690, height, minimized: false, maximized: false, zIndex: 100 + i }))
		}));
	}, { locationId, height });
}

test('saving closes stale grid drafts in another map window', async ({ page, request }) => {
	const location = await (await request.post('/api/entities', { data: { type: 'Location', name: 'Shared coast' } })).json();
	const map = await createMap(request, 'Shared grid');
	await request.patch(`/api/maps/${map.id}`, { data: { locationId: location.id } });
	await restoreMapWindows(page, location.id);
	await page.goto('/app');
	const windows = page.getByRole('dialog', { name: 'World Map', exact: true });
	await expect(windows).toHaveCount(2);
	for (const win of await windows.all()) await win.getByTitle('Grid settings', { exact: true }).click();
	const first = windows.nth(0).getByRole('dialog', { name: 'Map grid settings' });
	await first.getByLabel('Layout').selectOption('hex');
	await first.getByRole('button', { name: 'Save grid' }).click();
	await expect(page.getByRole('dialog', { name: 'Map grid settings' })).toHaveCount(0);
	await expect(windows.nth(0).getByTitle('Grid settings', { exact: true })).toBeFocused();
	await windows.nth(1).getByTitle('Grid settings', { exact: true }).click();
	await expect(windows.nth(1).getByLabel('Layout')).toHaveValue('hex');
});

test('grid settings fit inside a short map window and remain saveable', async ({ page, request }) => {
	const map = await createMap(request, 'Short window');
	await restoreMapWindows(page, null, 200);
	await page.goto('/app');
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.getByTitle('Grid settings', { exact: true }).click();
	const panel = win.getByRole('dialog', { name: 'Map grid settings' });
	const windowBox = (await win.boundingBox())!;
	const panelBox = (await panel.boundingBox())!;
	expect(panelBox.y + panelBox.height).toBeLessThan(windowBox.y + windowBox.height);
	await panel.getByLabel('Columns').fill('40');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel).toHaveCount(0);
	expect(await (await request.get(`/api/maps/${map.id}`)).json()).toMatchObject({ gridCellsX: 40 });
});

test('changing grid geometry discards incompatible paint redos', async ({ page, request }) => {
	const map = await createMap(request, 'Undo grid');
	await request.post(`/api/maps/${map.id}/events`, { data: { tPosition: 0, kind: 'paint_cells', payloadJsonb: { cells: [{ x: 2, y: 2, biome: 'Grass' }] } } });
	await page.goto('/app');
	await page.getByTitle('World Map', { exact: true }).click();
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.getByTitle('Undo (Ctrl/Cmd+Z)', { exact: true }).click();
	await expect(win.getByTitle('Redo (Ctrl/Cmd+Shift+Z)', { exact: true })).toBeEnabled();
	await win.getByTitle('Grid settings', { exact: true }).click();
	const panel = win.getByRole('dialog', { name: 'Map grid settings' });
	await panel.getByLabel('Layout').selectOption('hex');
	await panel.getByRole('button', { name: 'Save grid' }).click();
	await expect(panel).toHaveCount(0);
	await expect(win.getByTitle('Redo (Ctrl/Cmd+Shift+Z)', { exact: true })).toBeDisabled();
});

for (const change of ['layout', 'columns', 'rows'] as const) {
test(`a submitted stroke cannot cross a grid ${change} change`, async ({ page, request }) => {
	const map = await createMap(request, 'Delayed paint');
	await page.goto('/app');
	await page.getByTitle('World Map', { exact: true }).click();
	const win = page.getByRole('dialog', { name: 'World Map', exact: true });
	await win.getByRole('button', { name: 'Maximize', exact: true }).click();
	await win.getByTestId('map-tool-selector').getByRole('button', { name: 'Brush', exact: true }).click();
	const canvas = win.locator('.pixi-stage canvas');
	await expect(canvas).toBeVisible();
	let release!: () => void;
	let started!: () => void;
	const hold = new Promise<void>((resolve) => { release = resolve; });
	const painting = new Promise<void>((resolve) => { started = resolve; });
	await page.route(`**/api/maps/${map.id}/events`, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		started();
		await hold;
		await route.continue();
	});
	try {
		const box = (await canvas.boundingBox())!;
		await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
		await painting;
		await win.getByTitle('Grid settings', { exact: true }).click();
		const panel = win.getByRole('dialog', { name: 'Map grid settings' });
		if (change === 'layout') await panel.getByLabel('Layout').selectOption('hex');
		else await panel.getByLabel(change === 'columns' ? 'Columns' : 'Rows', { exact: true }).fill('64');
		await panel.getByRole('button', { name: 'Save grid' }).click();
		await expect(panel).toHaveCount(0);
		const result = page.waitForResponse((r) => r.url().endsWith(`/api/maps/${map.id}/events`) && r.request().method() === 'POST');
		release();
		expect((await result).status()).toBe(409);
		await expect(win.getByRole('alert')).toContainText('grid changed');
		expect((await (await request.get(`/api/maps/${map.id}/events`)).json()).rows).toHaveLength(0);
	} finally { release(); }
});
}
