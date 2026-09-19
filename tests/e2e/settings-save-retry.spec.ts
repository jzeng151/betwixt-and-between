import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

test('successful Settings retries clear only their own failures, including after reopening', async ({ page, request }) => {
	const suffix = Date.now();
	const presetName = `Saved colors ${suffix}`;
	const original = await (await request.get('/api/preferences')).json();
	const profile = await (await request.post('/api/preferences/profiles', { data: { name: `Retry profile ${suffix}` } })).json();
	try {
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/app');
		await page.getByTitle('Settings', { exact: true }).click();
		const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
		await settings.getByRole('button', { name: 'Profiles', exact: true }).click();
		let failRename = true;
		let failPreset = true;
		await page.route('**/api/preferences/profiles/*', route => failRename && route.request().method() === 'PATCH'
			? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Rename unavailable' }) })
			: route.continue());
		await page.route('**/api/preferences/presets', route => failPreset && route.request().method() === 'POST'
			? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Preset unavailable' }) })
			: route.continue());
		await settings.locator('.profile-row.active').getByRole('button', { name: 'Rename', exact: true }).click();
		await settings.locator('.rename-input').fill('Saved after retry');
		await settings.locator('.rename-input').press('Enter');
		await expect(settings.getByText('Rename unavailable', { exact: true })).toBeVisible();
		await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
		await settings.getByPlaceholder('New preset name').fill(presetName);
		await settings.getByRole('button', { name: 'Save current', exact: true }).click();
		await expect(settings.getByText('Preset unavailable', { exact: true })).toBeVisible();
		failPreset = false;
		await settings.getByPlaceholder('New preset name').fill(`${presetName} other`);
		await settings.getByRole('button', { name: 'Save current', exact: true }).click();
		await expect(settings.locator('.preset-row', { hasText: `${presetName} other` })).toBeVisible();
		await settings.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(settings.getByText('Preset unavailable', { exact: true })).toBeVisible();
		await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
		const wasDark = await settings.getByRole('radio', { name: 'Dark', exact: true }).isChecked();
		await settings.getByRole('radio', { name: wasDark ? 'Light' : 'Dark', exact: true }).check();
		await settings.getByPlaceholder('New preset name').fill(presetName);
		await settings.getByRole('button', { name: 'Save current', exact: true }).click();
		await expect(settings.locator('.preset-row', { hasText: presetName })).toHaveCount(2);
		await settings.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(settings.getByText('Preset unavailable', { exact: true })).toBeVisible();
		await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
		await settings.getByRole('radio', { name: wasDark ? 'Dark' : 'Light', exact: true }).check();
		failRename = false;
		await settings.getByRole('button', { name: 'Profiles', exact: true }).click();
		await settings.locator('.rename-input').press('Enter');
		await expect(settings.locator('.profile-row.active .profile-name')).toHaveText('Saved after retry');
		await settings.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(settings.getByText('Rename unavailable', { exact: true })).toHaveCount(0);
		await expect(settings.getByText('Preset unavailable', { exact: true })).toBeVisible();
		// Retry from a reopened Settings window, so identity cannot rely on its instance.
		await settings.getByRole('button', { name: 'Close', exact: true }).click();
		await page.getByTitle('Settings', { exact: true }).click();
		await settings.getByPlaceholder('New preset name').fill(presetName);
		failPreset = false;
		await settings.getByRole('button', { name: 'Save current', exact: true }).click();
		await expect(settings.locator('.preset-row', { hasText: presetName })).toHaveCount(3);
		await settings.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(settings.getByRole('button', { name: 'Acknowledge failed changes' })).toHaveCount(0);
	} finally {
		const presets = await (await request.get('/api/preferences/presets')).json();
		for (const preset of presets.user.filter((p: { name: string }) => p.name.startsWith(presetName))) {
			await request.delete(`/api/preferences/presets/${preset.presetId}`);
		}
		await request.post(`/api/preferences/profiles/${original.profileId}/activate`);
		await request.delete(`/api/preferences/profiles/${profile.profileId}`);
	}
});
