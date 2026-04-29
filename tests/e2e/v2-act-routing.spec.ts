import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

async function openStoryGraph(page: Page) {
	await page.click('button[title="Story Graph"]');
	const win = page.locator('.window[aria-label="Story Graph"]').first();
	await expect(win).toBeVisible();
	return win;
}

test.describe('V2 Act routing (D10-extension / 19A)', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('clicking an Act node in Story Graph opens an entity-detail window (NOT timeline)', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const sg = await openStoryGraph(page);
		// EntityLink in story graph for the act
		const node = sg.locator(`[data-entity-id="${a.id}"]`).first();
		await node.click();

		// A standalone entity-detail window opens (not just a tab inside the timeline)
		await expect(page.locator('.window[aria-label="Act A"]')).toBeVisible({ timeout: 3000 });
		// And it must not be a timeline window for the act — the timeline window
		// stays generic. Verify by checking the entity-detail surface markup.
		await expect(
			page.locator('.window[aria-label="Act A"] .entity-detail')
		).toBeVisible();
	});

	test('Event node click in Story Graph also opens entity-detail (D10-ext)', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const ev = await (
			await request.post('/api/entities', { data: { type: 'Event', name: 'Battle' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ev.id, start_act_id: a.id, end_act_id: a.id }
		});

		const sg = await openStoryGraph(page);
		await sg.locator(`[data-entity-id="${ev.id}"]`).first().click();
		await expect(page.locator('.window[aria-label="Battle"] .entity-detail')).toBeVisible({
			timeout: 3000
		});
	});

	test('Clicking same act in Timeline header focuses the existing entity-detail window (mutex)', async ({
		page,
		request
	}) => {
		const a = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		// Open via story graph first → standalone entity-detail window
		const sg = await openStoryGraph(page);
		await sg.locator(`[data-entity-id="${a.id}"]`).first().click();
		const popout = page.locator('.window[aria-label="Act A"]');
		await expect(popout).toBeVisible({ timeout: 3000 });
		const initialZ = await popout.evaluate((el) => Number((el as HTMLElement).style.zIndex || '0'));

		// Now click the same act in the Timeline window's header
		const tl = await openTimeline(page);
		await tl.locator(`.act-col-header[data-entity-id="${a.id}"]`).click();

		// Side panel must NOT open inside the timeline window — pop-out is focused instead
		await expect(tl.locator('.entity-detail')).toHaveCount(0);
		const newZ = await popout.evaluate((el) => Number((el as HTMLElement).style.zIndex || '0'));
		expect(newZ).toBeGreaterThan(initialZ);
	});

	test('Character/Location/Note routing unchanged (Character → character-editor)', async ({
		page,
		request
	}) => {
		const c = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();

		const sg = await openStoryGraph(page);
		await sg.locator(`[data-entity-id="${c.id}"]`).first().click();
		// Character still uses the existing character-editor surface
		await expect(page.locator('.window[aria-label="Ellie"]')).toBeVisible({ timeout: 3000 });
		// And NOT the entity-detail surface (D10-extension preserves Character routing)
		await expect(
			page.locator('.window[aria-label="Ellie"] .entity-detail')
		).toHaveCount(0);
	});
});
