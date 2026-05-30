// PlaceablePalette — Slice 4 PR-D. The consolidated placeables palette (merge
// of the former PlaceablesPalette + AssetLibrary). Pins:
//   - chip aria-pressed toggle state (WCAG 4.1.2 — armed state programmatically
//     determinable, not just the .armed CSS class). Migrated from the old
//     PlaceablesPalette.test.ts.
//   - D3 fix: data.is_asset === false removes an entity from the single list,
//     so click-to-place no longer leaks opted-out entities.
//   - each chip is a drag source (draggable + ASSET_DRAG_MIME), folding in the
//     former AssetLibrary behavior.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import PlaceablePalette from '$lib/components/PlaceablePalette.svelte';
import { ASSET_DRAG_MIME } from '$lib/components/asset-drag.js';
import { entities, type Entity } from '$lib/stores/entities.js';

function makeEntity(
	id: string,
	name: string,
	type: Entity['type'] = 'Character',
	data: Record<string, unknown> = {}
): Entity {
	return {
		id,
		type,
		name,
		data,
		parentId: null,
		position: 0,
		createdAt: new Date(0),
		updatedAt: new Date(0)
	} as Entity;
}

function makeResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => JSON.stringify(body)
	} as unknown as Response;
}

async function loadFixture(fixture: Entity[]) {
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(fixture)) as unknown as typeof fetch;
	await entities.load();
}

beforeEach(async () => {
	cleanup();
	await loadFixture([makeEntity('alice', 'Alice'), makeEntity('art-1', 'Sword', 'Artifact')]);
});

describe('PlaceablePalette — chip aria-pressed', () => {
	it('renders chip with aria-pressed="false" when no chip is armed', () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: null, onArm } });
		const chip = container.querySelector('button.chip') as HTMLButtonElement | null;
		expect(chip).toBeTruthy();
		expect(chip?.getAttribute('aria-pressed')).toBe('false');
	});

	it('flips aria-pressed to "true" for the armed chip only', () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: 'alice', onArm } });
		const chips = Array.from(container.querySelectorAll('button.chip')) as HTMLButtonElement[];
		const aliceChip = chips.find((b) => b.textContent?.includes('Alice'));
		const swordChip = chips.find((b) => b.textContent?.includes('Sword'));
		expect(aliceChip?.getAttribute('aria-pressed')).toBe('true');
		expect(swordChip?.getAttribute('aria-pressed')).toBe('false');
	});

	it('click on an unarmed chip fires onArm(id)', async () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: null, onArm } });
		const aliceChip = Array.from(container.querySelectorAll('button.chip')).find((b) =>
			b.textContent?.includes('Alice')
		) as HTMLButtonElement;
		await fireEvent.click(aliceChip);
		expect(onArm).toHaveBeenCalledWith('alice');
	});

	it('click on the currently-armed chip fires onArm(null) to disarm', async () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: 'alice', onArm } });
		const aliceChip = Array.from(container.querySelectorAll('button.chip')).find((b) =>
			b.textContent?.includes('Alice')
		) as HTMLButtonElement;
		await fireEvent.click(aliceChip);
		expect(onArm).toHaveBeenCalledWith(null);
	});

	it('the "+ New" affordance buttons do NOT carry aria-pressed (stateless actions)', () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: null, onArm } });
		const newButtons = Array.from(
			container.querySelectorAll('.palette-new button')
		) as HTMLButtonElement[];
		expect(newButtons.length).toBeGreaterThan(0);
		for (const btn of newButtons) {
			expect(btn.hasAttribute('aria-pressed')).toBe(false);
		}
	});
});

describe('PlaceablePalette — drag source (folds in AssetLibrary)', () => {
	it('chips are draggable and set the asset MIME on dragstart', async () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: null, onArm } });
		const chip = container.querySelector('button.chip') as HTMLButtonElement;
		expect(chip.getAttribute('draggable')).toBe('true');

		const setData = vi.fn();
		const dataTransfer = { effectAllowed: '', setData } as unknown as DataTransfer;
		const ev = new Event('dragstart', { bubbles: true }) as DragEvent;
		Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
		chip.dispatchEvent(ev);
		// First chip alphabetically is Alice. Pin the full drag protocol the
		// merged palette inherits from the old AssetLibrary.
		expect(dataTransfer.effectAllowed).toBe('copy');
		expect(setData).toHaveBeenCalledWith(ASSET_DRAG_MIME, 'alice');
		// Plain-text fallback for dev tools / accidental drops outside our handler.
		expect(setData).toHaveBeenCalledWith('text/plain', 'betwixt-asset:alice');
	});
});

describe('PlaceablePalette — D3 is_asset opt-out', () => {
	it('hides an entity flagged data.is_asset === false from the single list', async () => {
		await loadFixture([
			makeEntity('alice', 'Alice'),
			makeEntity('hidden', 'Hidden One', 'Artifact', { is_asset: false })
		]);
		const onArm = vi.fn();
		const { container } = render(PlaceablePalette, { props: { armedId: null, onArm } });
		const names = Array.from(container.querySelectorAll('button.chip .chip-name')).map(
			(n) => n.textContent
		);
		expect(names).toContain('Alice');
		expect(names).not.toContain('Hidden One');
	});

	it('shows the mandated empty state when no placeables qualify', async () => {
		await loadFixture([makeEntity('loc', 'Realm', 'Location')]);
		const onArm = vi.fn();
		const { container, getByText } = render(PlaceablePalette, { props: { armedId: null, onArm } });
		expect(container.querySelectorAll('button.chip')).toHaveLength(0);
		expect(getByText(/No placeables yet/i)).toBeTruthy();
	});
});
