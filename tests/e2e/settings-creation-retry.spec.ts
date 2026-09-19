import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

for (const kind of ['profile', 'preset'] as const) {
	test(`a committed ${kind} with a lost response is reused after reopening Settings`, async ({ page, request }) => {
		const name = `Lost ${kind} ${Date.now()}`;
		const endpoint = `/api/preferences/${kind}s`;
		const original = await (await request.get('/api/preferences')).json();
		const { profiles } = await (await request.get('/api/preferences/profiles')).json();
		const originalName = profiles.find((p: { profileId: string }) => p.profileId === original.profileId).name;
		let loseResponse = true;
		const sentIds: string[] = [];
		const list = async () => {
			const data = await (await request.get(endpoint)).json();
			return (kind === 'profile' ? data.profiles : data.user).filter((row: { name: string }) => row.name === name);
		};
		try {
			await page.route(`**/api/preferences/${kind}s`, async route => {
				if (route.request().method() !== 'POST') return route.continue();
				sentIds.push(route.request().postDataJSON()[`${kind}Id`]);
				if (!loseResponse) return route.continue();
				loseResponse = false;
				const committed = await route.fetch();
				expect(committed.ok()).toBe(true);
				await route.abort('failed');
			});
			await page.goto('/app');
			await page.getByTitle('Settings', { exact: true }).click();
			const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
			const section = kind === 'profile' ? 'Profiles' : 'Appearance';
			const save = kind === 'profile' ? 'New profile' : 'Save current';
			await settings.getByRole('button', { name: section, exact: true }).click();
			await settings.getByPlaceholder(`New ${kind} name`).fill(name);
			await settings.getByRole('button', { name: save, exact: true }).click();
			await expect(settings.locator('.inline-error')).toBeVisible();
			expect(await list()).toHaveLength(1);
			await settings.getByRole('button', { name: 'Close', exact: true }).click();
			await page.getByTitle('Settings', { exact: true }).click();
			await settings.getByRole('button', { name: section, exact: true }).click();
			if (kind === 'profile') {
				// Changing the current source must not turn an unresolved creation into a new attempt.
				await settings.getByRole('button', { name: originalName, exact: true }).click();
				await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
				const wasDark = await settings.getByRole('radio', { name: 'Dark', exact: true }).isChecked();
				const saved = page.waitForResponse(r => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH' && r.ok());
				await settings.getByRole('radio', { name: wasDark ? 'Light' : 'Dark', exact: true }).check();
				await saved;
				await settings.getByRole('button', { name: 'Profiles', exact: true }).click();
			}
			await settings.getByPlaceholder(`New ${kind} name`).fill(name);
			await settings.getByRole('button', { name: save, exact: true }).click();
			await expect(settings.getByPlaceholder(`New ${kind} name`)).toHaveValue('');
			expect(await list()).toHaveLength(1);
			expect(sentIds[0]).toMatch(/^[a-f0-9-]{36}$/);
			expect(sentIds[1]).toBe(sentIds[0]);
			await settings.getByRole('button', { name: 'Account', exact: true }).click();
			await expect(settings.getByRole('button', { name: 'Acknowledge failed changes' })).toHaveCount(0);
			// An acknowledged success ends the operation; creating the same thing again is intentional.
			await settings.getByRole('button', { name: section, exact: true }).click();
			await settings.getByPlaceholder(`New ${kind} name`).fill(name);
			await settings.getByRole('button', { name: save, exact: true }).click();
			await expect(settings.getByPlaceholder(`New ${kind} name`)).toHaveValue('');
			expect(await list()).toHaveLength(2);
			expect(sentIds[2]).not.toBe(sentIds[0]);
		} finally {
			await request.post(`/api/preferences/profiles/${original.profileId}/activate`);
			if (kind === 'profile') {
				const current = await (await request.get('/api/preferences')).json();
				const restored = await request.patch('/api/preferences', { data: {
					profileId: original.profileId, version: current.version,
					...(original.data.appearance?.theme ? { set: { appearance: { theme: original.data.appearance.theme } } } : { unset: ['appearance.theme'] })
				} });
				expect(restored.ok()).toBe(true);
			}
			for (const row of await list()) await request.delete(`${endpoint}/${row[`${kind}Id`]}`);
		}
	});
}
