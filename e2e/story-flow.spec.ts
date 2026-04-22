import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Story flow', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('tutorial-dismissed', 'true');
		});
		// Reset DB between tests via the API (delete all entities)
		await page.goto('/');
		await page.evaluate(async () => {
			const res = await fetch('/api/entities');
			const ents: Array<{ id: string }> = await res.json();
			await Promise.all(ents.map((e) => fetch(`/api/entities/${e.id}`, { method: 'DELETE' })));
		});
	});

	test('create a character in under 30 seconds', async ({ page }) => {
		const start = Date.now();

		// Open Characters from dock
		await page.click('button[title="Characters"]');
		const charWin = page.locator('.window[aria-label="Character"]');
		await expect(charWin).toBeVisible();

		// Creation form should appear since no entityId
		const nameInput = charWin.locator('input[placeholder="Character name…"]');
		await expect(nameInput).toBeVisible();

		// Type a name and submit
		await nameInput.fill('Elara Voss');
		await nameInput.press('Enter');

		// Editor should now show the entity name
		await expect(charWin.locator('.entity-name')).toHaveText('Elara Voss', { timeout: 5000 });

		expect(Date.now() - start).toBeLessThan(30_000);
	});

	test('rename character in editor → name updates immediately', async ({ page }) => {
		// Create a character through the UI creation flow
		await page.click('button[title="Characters"]');
		const charWin = page.locator('.window[aria-label="Character"]');
		await expect(charWin).toBeVisible();

		await charWin.locator('input[placeholder="Character name…"]').fill('Original Name');
		await charWin.locator('input[placeholder="Character name…"]').press('Enter');
		await expect(charWin.locator('.entity-name')).toHaveText('Original Name', { timeout: 5000 });

		// Open Details section and rename
		await charWin.locator('button', { hasText: 'Details' }).click();
		const nameInput = charWin.locator('#char-name');
		await nameInput.fill('Renamed Character');
		await nameInput.blur();

		// Header should update in the same tick via optimistic store update
		await expect(charWin.locator('.entity-name')).toHaveText('Renamed Character', { timeout: 3000 });
	});

	test('add event entity → appears as a node in Story Graph', async ({ page }) => {
		// Open Story Graph first
		await page.click('button[title="Story Graph"]');
		const graphWin = page.locator('.window[aria-label="Story Graph"]');
		await expect(graphWin).toBeVisible();

		// Create an event via API
		await page.evaluate(async () => {
			await fetch('/api/entities', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'Event', name: 'The Battle' }),
			});
		});

		// Reload the page stores by navigating (simplest way in preview mode)
		await page.reload();
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
		await page.goto('/');
		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

		await page.click('button[title="Story Graph"]');
		await page.waitForTimeout(2000);

		// The graph should no longer show the empty overlay
		const emptyOverlay = page.locator('.empty-overlay');
		await expect(emptyOverlay).not.toBeVisible();
	});
});
