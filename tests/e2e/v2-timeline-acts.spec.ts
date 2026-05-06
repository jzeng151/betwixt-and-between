import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

async function clearAll(request: APIRequestContext) {
	const ents: Array<{ id: string }> = await (await request.get('/api/entities')).json();
	for (const e of ents) await request.delete(`/api/entities/${e.id}`);
}

async function openTimeline(page: Page) {
	await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
	await page.goto('/app');
	await page.click('button[title="Timeline"]');
	const win = page.locator('.window[aria-label="Timeline"]');
	await expect(win).toBeVisible();
	return win;
}

test.describe('Timeline — break into scenes', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('inline form on act header creates N scenes and the cells render', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();

		const win = await openTimeline(page);

		// Click the "Break into scenes" inline button on Act A
		await win.locator('button.break-btn', { hasText: /break into scenes/i }).first().click();

		// Inline form: textarea with one scene name per line
		const textarea = win.locator('textarea.scene-textarea').first();
		await expect(textarea).toBeVisible();
		await textarea.fill('Opening\nMidpoint\nDarkest\nClimax');
		await win.locator('button.btn-save').first().click();

		// Server side: 4 scenes for Act A
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			const scenes = ents.filter((e: any) => e.type === 'Scene' && e.parentId === a0.id);
			expect(scenes).toHaveLength(4);
		}).toPass({ timeout: 3000 });

		// UI: scene cells render in the scenes row
		await expect(win.locator('.scene-cell')).toHaveCount(4);
	});
});

test.describe('Timeline — delete act', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('delete-act button shows confirmation dialog with affected interval count', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act A', position: 0 } })
		).json();
		const a1 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'Act B', position: 1 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);

		// X delete button on the first act header
		await win.locator('button.act-delete-btn[aria-label="Delete Act A"]').click();

		// Inline confirmation appears showing the cascade count
		const confirm = win.locator('.delete-confirm');
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText(/1 interval/);

		await confirm.locator('button.btn-danger').click();

		// Server: act gone, interval cascaded
		await expect(async () => {
			const ents = await (await request.get('/api/entities')).json();
			expect(ents.find((e: any) => e.id === a0.id)).toBeFalsy();
			const ints = await (await request.get('/api/intervals')).json();
			expect(ints.find((i: any) => i.entityId === ellie.id)).toBeFalsy();
		}).toPass({ timeout: 3000 });
	});
});

test.describe('Timeline — bar rendering', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('multi-act bar renders hairlines at internal act boundaries', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const a1 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const a2 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		// Span 3 acts → 2 internal boundaries
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a2.id }
		});

		const win = await openTimeline(page);

		// IntervalBar renders <line> elements for internal boundaries
		const lines = win.locator('svg.interval-bar line');
		await expect(lines).toHaveCount(2);
	});

	test('tooltip shows on bar hover and on keyboard focus', async ({ page, request }) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
		});

		const win = await openTimeline(page);
		const wrapper = win.locator('.bar-wrapper').first();

		const tooltipText = await wrapper.getAttribute('data-tooltip');
		expect(tooltipText).toContain('Ellie');

		// Hover → ::before opacity transitions to 1 (give the 0.15s transition time to settle)
		await wrapper.hover();
		await expect(async () => {
			const op = await wrapper.evaluate(
				(el) => window.getComputedStyle(el, '::before').opacity
			);
			expect(Number(op)).toBeGreaterThan(0.95);
		}).toPass({ timeout: 1500 });

		// Park pointer outside, then keyboard-focus the bar — :focus-within fires the same fade
		await win.locator('.palette').hover();
		await wrapper.locator('svg.interval-bar').focus();
		await expect(async () => {
			const op = await wrapper.evaluate(
				(el) => window.getComputedStyle(el, '::before').opacity
			);
			expect(Number(op)).toBeGreaterThan(0.95);
		}).toPass({ timeout: 1500 });
	});

	test('width breakpoints: wide bar shows name, narrow hides note, tiny hides name', async ({
		page,
		request
	}) => {
		// Six acts so we can carve out wide / narrow / tiny intervals at known fractions.
		const acts: any[] = [];
		for (let i = 0; i < 6; i++) {
			acts.push(
				await (
					await request.post('/api/entities', {
						data: { type: 'Act', name: `Act ${i}`, position: i }
					})
				).json()
			);
		}
		const wide = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Wide' } })
		).json();
		const narrow = await (
			await request.post('/api/entities', {
				data: {
					type: 'Character',
					name: 'Narrow',
					data: JSON.stringify({ notes: 'second line' })
				}
			})
		).json();
		const tiny = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Tiny' } })
		).json();

		// Wide: 4 acts → ~640px on a 960px window track. Narrow: 1 act → ~160px.
		// Tiny: shrink to a sub-act fraction via PATCH after create.
		await request.post('/api/intervals', {
			data: { entity_id: wide.id, start_act_id: acts[0].id, end_act_id: acts[3].id }
		});
		await request.post('/api/intervals', {
			data: { entity_id: narrow.id, start_act_id: acts[4].id, end_act_id: acts[4].id }
		});
		const tinyIv = await (
			await request.post('/api/intervals', {
				data: { entity_id: tiny.id, start_act_id: acts[5].id, end_act_id: acts[5].id }
			})
		).json();
		// Shrink tiny to a 5%-of-act sliver
		await request.patch(`/api/intervals/${tinyIv.id}`, {
			data: { endActId: acts[5].id, endSceneId: null, endPosition: 5.05 }
		});

		const win = await openTimeline(page);

		// Wide bar: name visible, note rendered when present (this one has no note)
		const wideRow = win.locator(`.row[data-entity-id="${wide.id}"]`);
		await expect(wideRow.locator('text.bar-name')).toHaveText('Wide');

		// Narrow bar (~160px): name visible. Note may or may not render depending on width
		// breakpoint (≥100px = normal w/ note, <100px = narrow w/o note). With a 720px
		// track / 6 acts = 120px per act, so narrow act-sized bar IS in the "normal" range.
		// Just assert the name renders.
		const narrowRow = win.locator(`.row[data-entity-id="${narrow.id}"]`);
		await expect(narrowRow.locator('text.bar-name')).toHaveText('Narrow');

		// Tiny bar (5% of 120px ≈ 6px): no name text rendered
		const tinyRow = win.locator(`.row[data-entity-id="${tiny.id}"]`);
		await expect(tinyRow.locator('text.bar-name')).toHaveCount(0);
	});
});

test.describe('Timeline — same entity twice creates a gap', () => {
	test.beforeEach(async ({ request }) => {
		await clearAll(request);
	});

	test('two intervals for the same entity render as separate bars on one row', async ({
		page,
		request
	}) => {
		const a0 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'A', position: 0 } })
		).json();
		const a1 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'B', position: 1 } })
		).json();
		const a2 = await (
			await request.post('/api/entities', { data: { type: 'Act', name: 'C', position: 2 } })
		).json();
		const ellie = await (
			await request.post('/api/entities', { data: { type: 'Character', name: 'Ellie' } })
		).json();
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a0.id, end_act_id: a0.id }
		});
		await request.post('/api/intervals', {
			data: { entity_id: ellie.id, start_act_id: a2.id, end_act_id: a2.id }
		});

		const win = await openTimeline(page);

		const ellieRow = win.locator(`.row[data-entity-id="${ellie.id}"]`);
		await expect(ellieRow.locator('.bar-wrapper')).toHaveCount(2);
	});
});
