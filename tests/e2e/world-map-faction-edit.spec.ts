/**
 * Slice 3 F2 (Slice 1b T13 carry-over) — inline faction rename.
 *
 * The MapSidebar Factions list lets the user click a faction name to edit
 * it inline; Enter commits via PATCH /api/factions/[id]. This drives the
 * rename through the UI and asserts the persisted row changed.
 *
 * (Recolor is intentionally not E2E-driven here — entering edit mode
 * autofocuses the name input, and clicking the color stripe blurs it,
 * which commits+exits edit before the swatch picker can open. That UX
 * blur-race is tracked separately; the recolor PATCH path itself is
 * covered by API/integration tests.)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
	const maps: Array<{ id: string }> = await (await request.get('/api/maps')).json();
	for (const m of maps) await request.delete(`/api/maps/${m.id}`);
	const { rows: facs }: { rows: Array<{ id: string; isSystem?: boolean }> } = await (
		await request.get('/api/factions')
	).json();
	for (const f of facs) if (!f.isSystem) await request.delete(`/api/factions/${f.id}`);
}

async function factionById(request: APIRequestContext, id: string) {
	const { rows }: { rows: Array<{ id: string; name: string; color: string }> } = await (
		await request.get('/api/factions')
	).json();
	return rows.find((f) => f.id === id) ?? null;
}

test('rename a faction inline from the sidebar', async ({ page, request }) => {
	await clearAll(request);
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));

	// Need a map so the sidebar mounts; faction is user-scoped (seed via API).
	const map = await (await request.post('/api/maps', { data: { name: 'Faction Test' } })).json();
	await request.patch(`/api/maps/${map.id}`, {
		data: { baseImageUrl: 'about:blank', width: 640, height: 480 }
	});
	const faction = await (
		await request.post('/api/factions', { data: { name: 'Old Banner', color: '#3b82f6' } })
	).json();

	await page.goto('/app');
	await page.click('button[title="World Map"]');
	const win = page.locator('.window[aria-label="World Map"]');
	await expect(win).toBeVisible();

	// ── Rename ───────────────────────────────────────────────────────────
	const nameButton = win.locator('.faction-name-button', { hasText: 'Old Banner' });
	await expect(nameButton).toBeVisible({ timeout: 10000 });
	await nameButton.click();

	const editInput = win.locator('.faction-row.editing input.faction-name-input');
	await expect(editInput).toBeVisible();
	await editInput.fill('New Banner');
	await editInput.press('Enter');

	await expect
		.poll(async () => (await factionById(request, faction.id))?.name, { timeout: 8000 })
		.toBe('New Banner');
});
