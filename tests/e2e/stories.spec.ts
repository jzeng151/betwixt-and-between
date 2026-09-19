import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS, E2E_USER_ID } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });

test('creates and renames stories, isolates two tabs, and restores each story workspace', async ({ page, context, request }) => {
	const suffix = Date.now();
	const original = `Original character ${suffix}`;
	const storyName = `Second story ${suffix}`;
	await request.post('/api/entities', { data: { type: 'Character', name: original } });
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.getByTitle('Wiki', { exact: true }).click();
	const wiki = page.locator('.window[aria-label="Wiki"]');
	await wiki.locator('.entry', { hasText: original }).click();
	const other = await context.newPage();
	await other.goto('/app');
	await other.getByTitle('Wiki', { exact: true }).click();
	await expect(other.locator('.entry', { hasText: original })).toBeVisible();
	await page.getByTitle('Settings', { exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByLabel('New story name').fill(storyName);
	await settings.getByRole('button', { name: 'Create story', exact: true }).click();
	await settings.getByRole('button', { name: `Open ${storyName}`, exact: true }).click();
	await expect(page).toHaveURL(/\/app\?story=/);
	const storyId = new URL(page.url()).searchParams.get('story')!;
	expect(storyId).not.toBe(E2E_USER_ID);
	await expect(wiki).toHaveCount(0);
	await page.getByTitle('Wiki', { exact: true }).click();
	await wiki.getByRole('button', { name: 'Create a character' }).click();
	const name = wiki.locator('.entity-detail-header .inline-edit-input');
	await name.fill(`Second character ${suffix}`);
	await name.press('Enter');
	await expect.poll(async () => (await (await request.get('/api/entities', { headers: { 'x-story-id': storyId } })).json()).map((e: any) => e.name)).toEqual([`Second character ${suffix}`]);
	await expect(other.locator('.entry', { hasText: original })).toBeVisible();
	await other.reload();
	await expect(other.locator('.entry', { hasText: original })).toBeVisible();
	await expect(other.locator('.entry', { hasText: `Second character ${suffix}` })).toHaveCount(0);
	await page.getByTitle('Settings', { exact: true }).click();
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByLabel('Current story name').fill(`${storyName} renamed`);
	await settings.getByRole('button', { name: 'Rename', exact: true }).click();
	await expect(page.locator('.story-name')).toHaveText(`${storyName} renamed`);
	const originalStory = (await (await request.get('/api/stories')).json()).find((s: any) => s.id === E2E_USER_ID);
	await settings.getByRole('button', { name: `Open ${originalStory.name}`, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`story=${E2E_USER_ID}`));
	await expect(wiki.locator('.entity-detail-title-text')).toHaveText(original);
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByRole('button', { name: `Open ${storyName} renamed`, exact: true }).click();
	await expect(wiki.locator('.entity-detail-title-text')).toHaveText(`Second character ${suffix}`);
	await expect(wiki.locator('.entry', { hasText: original })).toHaveCount(0);
	await other.close();
});

test('a failed Notes save cancels switching and retry saves to the original story', async ({ page, request }) => {
	const suffix = Date.now();
	const target = await (await request.post('/api/stories', { data: { name: `Save target ${suffix}` } })).json();
	const folder = await (await request.post('/api/notes/folders', { data: { name: `Save folder ${suffix}` } })).json();
	const entry = await (await request.post('/api/notes/entries', { data: { name: `Draft ${suffix}`, body: '', parentId: folder.id } })).json();
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.getByTitle('Notes', { exact: true }).click();
	const notes = page.locator('.window[aria-label="Notes"]');
	await notes.getByRole('button', { name: folder.name, exact: true }).click();
	await notes.getByRole('button', { name: new RegExp(entry.name) }).click();
	let fail = true;
	await page.route(`**/api/notes/entries/${entry.id}`, route => fail && route.request().method() === 'PATCH'
		? route.fulfill({ status: 503, body: 'Unavailable' }) : route.continue());
	await notes.getByPlaceholder('Start writing...').fill('Keep my unfinished sentence.');
	await page.getByTitle('Settings', { exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByRole('button', { name: `Open ${target.name}`, exact: true }).click();
	await expect(settings.getByRole('alert')).toContainText(/save|saving/i);
	await expect(page).toHaveURL(/\/app$/);
	await expect(notes.getByPlaceholder('Start writing...')).toHaveValue('Keep my unfinished sentence.');
	fail = false;
	await settings.getByRole('button', { name: `Open ${target.name}`, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`story=${target.id}`));
	const saved = (await (await request.get('/api/notes/entries')).json()).find((e: any) => e.id === entry.id);
	expect(saved.data.body).toBe('Keep my unfinished sentence.');
	expect(await (await request.get('/api/notes/entries', { headers: { 'x-story-id': target.id } })).json()).toEqual([]);
});

test('switching waits for an in-flight entity rename before leaving its story', async ({ page, request }) => {
	const suffix = Date.now();
	const target = await (await request.post('/api/stories', { data: { name: `Pending target ${suffix}` } })).json();
	const entity = await (await request.post('/api/entities', { data: { type: 'Character', name: `Pending character ${suffix}` } })).json();
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.getByTitle('Wiki', { exact: true }).click();
	const wiki = page.locator('.window[aria-label="Wiki"]');
	await wiki.locator('.entry', { hasText: entity.name }).click();
	await wiki.getByRole('button', { name: 'Edit', exact: true }).click();
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	let started = false;
	await page.route(`**/api/entities/${entity.id}`, async route => {
		if (route.request().method() === 'PATCH') { started = true; await held; }
		await route.continue();
	});
	await wiki.locator('.entity-detail-header .inline-edit-input').fill(`Saved name ${suffix}`);
	await page.getByTitle('Settings', { exact: true }).click();
	await expect.poll(() => started).toBe(true);
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByRole('button', { name: `Open ${target.name}`, exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Switching stories', exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/app$/);
	release();
	await expect(page).toHaveURL(new RegExp(`story=${target.id}`));
	const saved = (await (await request.get('/api/entities')).json()).find((e: any) => e.id === entity.id);
	expect(saved.name).toBe(`Saved name ${suffix}`);
});

for (const closeGraph of [false, true]) {
test(`switching flushes ${closeGraph ? 'a closed' : 'an open'} graph position before its debounce timer fires`, async ({ page, request }) => {
	const suffix = Date.now();
	const target = await (await request.post('/api/stories', { data: { name: `Graph target ${suffix}` } })).json();
	const entity = await (await request.post('/api/entities', { data: { type: 'Character', name: `Graph character ${suffix}` } })).json();
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.getByTitle('Story Graph', { exact: true }).click();
	const node = page.locator(`.node[data-entity-id="${entity.id}"]`);
	await expect(node).toBeVisible();
	await page.clock.install();
	await page.clock.pauseAt(new Date(Date.now() + 1000));
	await node.press('ArrowRight');
	expect((await (await request.get('/api/canvas-positions')).json()).find((p: any) => p.entityId === entity.id)).toBeUndefined();
	if (closeGraph) await page.locator('.window[aria-label="Story Graph"]').getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByTitle('Settings', { exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
	await settings.getByRole('button', { name: 'Stories', exact: true }).click();
	await settings.getByRole('button', { name: `Open ${target.name}`, exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`story=${target.id}`));
	const saved = (await (await request.get('/api/canvas-positions')).json()).find((p: any) => p.entityId === entity.id);
	expect(saved).toMatchObject({ entityId: entity.id, storyId: E2E_USER_ID });
	expect(await (await request.get('/api/canvas-positions', { headers: { 'x-story-id': target.id } })).json()).toEqual([]);
});

}
