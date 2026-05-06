import { test, expect, type Page } from '@playwright/test';
import { clearAll } from './helpers/db';

// Regression for the delete-confirmation modal Escape-dismiss path.
// Greptile flagged that an earlier version attached `onkeydown` to the
// backdrop `<div role="presentation">`, which never receives keyboard
// focus and so the Escape key was a dead input. The fix moved the
// handler to `<svelte:window onkeydown>`. This test guards against
// someone moving it back onto the backdrop.

test.use({ storageState: { cookies: [], origins: [] } });

async function openStoryGraph(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="Story Graph"]');
	const win = page.locator('.window[aria-label="Story Graph"]').first();
	await expect(win).toBeVisible();
	return win;
}

test.describe('Story Graph delete-confirmation modal', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('Escape dismisses the modal without deleting the entity', async ({ page, request }) => {
		const c = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Aragorn' } })
		).json();

		const sg = await openStoryGraph(page);

		const node = sg.locator('.node[aria-label="Open Aragorn"]').first();
		await expect(node).toBeVisible();
		await node.click({ button: 'right' });

		await page.locator('button', { hasText: 'Delete…' }).click();

		const modal = page.locator('.delete-modal[role="dialog"]');
		await expect(modal).toBeVisible();
		await expect(modal).toContainText('Aragorn');

		await page.keyboard.press('Escape');

		await expect(modal).toBeHidden();

		// Entity must still exist — Escape cancels, it does not confirm.
		const ents = await (await request.get('/api/entities')).json();
		expect(ents.find((e: { id: string }) => e.id === c.id)).toBeDefined();
	});
});
