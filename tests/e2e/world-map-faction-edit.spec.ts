/**
 * Inline faction rename + recolor from the MapSidebar Factions list.
 *
 * The ✎ button (or clicking the name) opens an inline edit form: a name
 * field + color swatches (always visible) + Save/Cancel. Swatches select a
 * color; Save commits name + color together. Both PATCH /api/factions/[id].
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

test('rename and recolor a faction inline from the sidebar', async ({ page, request }) => {
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

	// ── Recolor ──────────────────────────────────────────────────────────
	// Re-enter edit via the ✎ button; the swatches are visible immediately.
	// Pick a different palette color (selects), then Save commits.
	await win.locator('[aria-label="Edit New Banner"]').click();
	const editingRow = win.locator('.faction-row.editing');
	await expect(editingRow).toBeVisible();
	await editingRow.locator('.color-swatch[aria-label="Color #ef4444"]').click();
	await editingRow.locator('.edit-actions .btn-primary').click();

	await expect
		.poll(async () => (await factionById(request, faction.id))?.color, { timeout: 8000 })
		.toBe('#ef4444');
});
