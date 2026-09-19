import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { E2E_USER_HEADERS } from './pglite-config.js';

test('Settings downloads saved story data and recovers from an export failure', async ({ page, request }) => {
	const name = `Exported note ${Date.now()}`;
	const created = await request.post('http://localhost:4173/api/entities', {
		headers: E2E_USER_HEADERS, data: { type: 'Note', name, data: { body: 'Keep this story.' } }
	});
	expect(created.ok()).toBe(true);
	await page.setExtraHTTPHeaders(E2E_USER_HEADERS);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Export', exact: true }).click();
	await page.route('**/api/export', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Export temporarily unavailable. Try again.' }) }), { times: 1 });
	await settings.getByRole('button', { name: 'Download saved data' }).click();
	await expect(settings.getByRole('alert')).toHaveText('Export temporarily unavailable. Try again.');
	const downloadPromise = page.waitForEvent('download');
	await settings.getByRole('button', { name: 'Download saved data' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^betwixt-story-.*\.json$/);
	const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
	expect(exported.tables.entities).toEqual(expect.arrayContaining([expect.objectContaining({ name, data: { body: 'Keep this story.' } })]));
	await expect(settings.getByRole('alert')).toHaveCount(0);
	await expect(settings.getByRole('status')).toHaveText('Download started.');
	expect((await request.get('http://localhost:4173/api/export')).status()).toBe(401);
});
