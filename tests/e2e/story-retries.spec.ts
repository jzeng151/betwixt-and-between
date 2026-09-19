import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS, E2E_USER_ID } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

test('story creation replays a lost response after reopening Settings and allows intentional copies', async ({ page, request }) => {
	const name = `Story retry ${Date.now()}`;
	let loseResponse = true;
	const ids: string[] = [];
	await page.route('**/api/stories', async route => {
		if (route.request().method() !== 'POST') return route.continue();
		ids.push(route.request().postDataJSON().id);
		if (!loseResponse) return route.continue();
		loseResponse = false;
		const response = await route.fetch();
		expect(response.ok()).toBe(true);
		await route.abort('failed');
	});
	await page.goto('/app');
	await page.getByTitle('Settings', { exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByLabel('New story name', { exact: true }).fill(name);
	await settings.getByRole('button', { name: 'Create story', exact: true }).click();
	await expect(settings.getByRole('alert')).toBeVisible();
	const copies = async () => (await (await request.get('/api/stories')).json()).filter((s: { name: string }) => s.name === name);
	expect(await copies()).toHaveLength(1);
	await settings.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByTitle('Settings', { exact: true }).click();
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByLabel('New story name', { exact: true }).fill(name);
	await settings.getByRole('button', { name: 'Create story', exact: true }).click();
	await expect(settings.getByLabel('New story name', { exact: true })).toHaveValue('');
	expect(await copies()).toHaveLength(1);
	expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/);
	expect(ids[1]).toBe(ids[0]);
	await settings.getByRole('button', { name: 'Account', exact: true }).click();
	await expect(settings.getByRole('button', { name: 'Acknowledge failed changes' })).toHaveCount(0);
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByLabel('New story name', { exact: true }).fill(name);
	await settings.getByRole('button', { name: 'Create story', exact: true }).click();
	await expect(settings.getByLabel('New story name', { exact: true })).toHaveValue('');
	expect(await copies()).toHaveLength(2);
	expect(ids[2]).not.toBe(ids[0]);
});

test('a story rename retry clears its failure after changing Settings sections', async ({ page, request }) => {
	const original = (await (await request.get('/api/stories')).json()).find((s: { id: string }) => s.id === E2E_USER_ID);
	let fail = true;
	await page.route('**/api/stories/*', route => fail && route.request().method() === 'PATCH'
		? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Rename unavailable' }) })
		: route.continue());
	try {
		await page.goto('/app');
		await page.getByTitle('Settings', { exact: true }).click();
		const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
		await settings.getByRole('button', { name: 'Stories', exact: true }).click();
		await settings.getByLabel('Current story name').fill('Renamed after retry');
		await settings.getByRole('button', { name: 'Rename', exact: true }).click();
		await expect(settings.getByRole('alert')).toHaveText('Rename unavailable');
		await settings.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(settings.getByText('Rename unavailable', { exact: true })).toBeVisible();
		await settings.getByRole('button', { name: 'Stories', exact: true }).click();
		fail = false;
		await settings.getByLabel('Current story name').fill('Renamed after retry');
		await settings.getByRole('button', { name: 'Rename', exact: true }).click();
		await expect(page.locator('.story-name')).toHaveText('Renamed after retry');
		await settings.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(settings.getByRole('button', { name: 'Acknowledge failed changes' })).toHaveCount(0);
	} finally {
		await request.patch(`/api/stories/${original.id}`, { data: { name: original.name } });
	}
});
