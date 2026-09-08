import { test, expect } from '@playwright/test';
import { E2E_USER_HEADERS } from './pglite-config.js';

test.use({ extraHTTPHeaders: E2E_USER_HEADERS, viewport: { width: 1440, height: 1000 } });

test('Notes keeps the latest edit when immediately returning to the folder list', async ({ page, request }) => {
  const folder = await (await request.post('/api/notes/folders', { data: { name: 'Autosave regression' } })).json();
  try {
    const entry = await (await request.post('/api/notes/entries', {
      data: { name: 'Opening scene', body: 'Original', parentId: folder.id }
    })).json();
    await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
    await page.goto('/app');
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    const notes = page.locator('.notes-app');
    await notes.getByText('Autosave regression', { exact: true }).click();
    await notes.getByText('Opening scene', { exact: true }).click();
    await notes.getByPlaceholder('Start writing...').fill('Mara arrives at the harbor.');
    await notes.getByRole('button', { name: 'Back to notes' }).click();
    await expect(notes.getByTitle('New note')).toBeVisible();
    await notes.getByText('Opening scene', { exact: true }).click();
    await expect(notes.getByPlaceholder('Start writing...')).toHaveValue('Mara arrives at the harbor.');
    await notes.getByRole('button', { name: 'Back to notes' }).click();
    await notes.getByTitle('New note').click();
    await expect(notes.getByPlaceholder('Entry title')).toHaveValue('Untitled');
    const rows = await (await request.get(`/api/notes/entries?folderId=${folder.id}`)).json();
    expect(rows.find((row: { id: string }) => row.id === entry.id).data.body).toBe('Mara arrives at the harbor.');
  } finally {
    await request.delete(`/api/notes/folders/${folder.id}`);
  }
});
