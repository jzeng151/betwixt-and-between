import { describe, expect, it, vi } from 'vitest';
import { focusTrap, setNextFocusTrapReturn, takeNextFocusReturn } from '$lib/actions/focus-trap.js';

describe('focusTrap', () => {
	it('moves, contains, and restores focus', async () => {
		const trigger = document.body.appendChild(document.createElement('button'));
		trigger.focus();
		const dialog = document.body.appendChild(document.createElement('div'));
		const first = dialog.appendChild(document.createElement('button'));
		const last = dialog.appendChild(document.createElement('button'));
		for (const element of [dialog, first, last]) {
			element.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
		}
		const onEscape = vi.fn();
		const action = focusTrap(dialog, { onEscape });

		await Promise.resolve();
		expect(document.activeElement).toBe(first);

		last.focus();
		last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
		expect(document.activeElement).toBe(first);

		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onEscape).toHaveBeenCalledOnce();

		action.destroy();
		expect(document.activeElement).toBe(trigger);
	});

	it('restores focus past a transient menu', async () => {
		const opener = document.body.appendChild(document.createElement('button'));
		const menuItem = document.body.appendChild(document.createElement('button'));
		menuItem.focus();
		setNextFocusTrapReturn(opener);
		menuItem.remove();

		const dialog = document.body.appendChild(document.createElement('div'));
		const action = focusTrap(dialog);
		action.destroy();

		expect(document.activeElement).toBe(opener);
	});

	it('hands a transient opener to a newly created window', () => {
		const opener = document.body.appendChild(document.createElement('button'));
		setNextFocusTrapReturn(opener);

		expect(takeNextFocusReturn(null)).toBe(opener);
		expect(takeNextFocusReturn(null)).toBeNull();
	});
});
