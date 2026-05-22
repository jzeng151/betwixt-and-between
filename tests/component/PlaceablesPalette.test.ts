// PlaceablesPalette — chip ARIA toggle-state.
//
// Added 2026-05-21 alongside the aria-pressed drive-by from Step 5.5
// (docs/findings/placeables-palette-aria-pressed.md). Pins WCAG 4.1.2
// (Name, Role, Value): the armed-state must be programmatically
// determinable, not just visually conveyed via the .armed CSS class.
//
// The "+ New" affordance buttons are stateless actions and do NOT get
// aria-pressed; this file deliberately does not assert anything on them.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import PlaceablesPalette from '$lib/components/PlaceablesPalette.svelte';
import { entities, type Entity } from '$lib/stores/entities.js';

function makeEntity(id: string, name: string, type: Entity['type'] = 'Character'): Entity {
	return {
		id,
		type,
		name,
		data: {},
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

beforeEach(async () => {
	cleanup();
	const fixture = [makeEntity('alice', 'Alice'), makeEntity('art-1', 'Sword', 'Artifact')];
	globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(fixture)) as unknown as typeof fetch;
	await entities.load();
});

describe('PlaceablesPalette — chip aria-pressed', () => {
	it('renders chip with aria-pressed="false" when no chip is armed', () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablesPalette, { props: { armedId: null, onArm } });
		const chip = container.querySelector('button.chip') as HTMLButtonElement | null;
		expect(chip).toBeTruthy();
		expect(chip?.getAttribute('aria-pressed')).toBe('false');
	});

	it('flips aria-pressed to "true" when the chip is armed via armedId prop', () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablesPalette, { props: { armedId: 'alice', onArm } });
		// Alice sorts first alphabetically with Sword — pick by chip-name.
		const chips = Array.from(container.querySelectorAll('button.chip')) as HTMLButtonElement[];
		const aliceChip = chips.find((b) => b.textContent?.includes('Alice'));
		const swordChip = chips.find((b) => b.textContent?.includes('Sword'));
		expect(aliceChip?.getAttribute('aria-pressed')).toBe('true');
		expect(swordChip?.getAttribute('aria-pressed')).toBe('false');
	});

	it('click on an unarmed chip fires onArm(id) — caller decides to flip aria-pressed', async () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablesPalette, { props: { armedId: null, onArm } });
		const aliceChip = Array.from(container.querySelectorAll('button.chip')).find((b) =>
			b.textContent?.includes('Alice')
		) as HTMLButtonElement;
		await fireEvent.click(aliceChip);
		expect(onArm).toHaveBeenCalledWith('alice');
	});

	it('click on the currently-armed chip fires onArm(null) to disarm', async () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablesPalette, { props: { armedId: 'alice', onArm } });
		const aliceChip = Array.from(container.querySelectorAll('button.chip')).find((b) =>
			b.textContent?.includes('Alice')
		) as HTMLButtonElement;
		await fireEvent.click(aliceChip);
		expect(onArm).toHaveBeenCalledWith(null);
	});

	it('the "+ New" affordance buttons do NOT carry aria-pressed (stateless actions)', () => {
		const onArm = vi.fn();
		const { container } = render(PlaceablesPalette, { props: { armedId: null, onArm } });
		const newButtons = Array.from(
			container.querySelectorAll('.palette-new button')
		) as HTMLButtonElement[];
		expect(newButtons.length).toBeGreaterThan(0);
		for (const btn of newButtons) {
			expect(btn.hasAttribute('aria-pressed')).toBe(false);
		}
	});
});
