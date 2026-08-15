import { describe, expect, it, vi } from 'vitest';
import { focusTrap, isActiveFocusTrapTarget, setNextFocusTrapReturn, takeNextFocusReturn } from '$lib/actions/focus-trap.js';

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

	it('redirects focus when the active control becomes disabled', async () => {
		const dialog = document.body.appendChild(document.createElement('div'));
		const first = dialog.appendChild(document.createElement('button'));
		const busy = dialog.appendChild(document.createElement('button'));
		for (const element of [dialog, first, busy]) {
			element.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
		}
		const action = focusTrap(dialog);
		await Promise.resolve();
		busy.focus();

		busy.disabled = true;
		await Promise.resolve();
		await Promise.resolve();

		expect(document.activeElement).toBe(first);
		action.destroy();
	});

	it('only enforces the most recently opened trap', async () => {
		const firstDialog = document.body.appendChild(document.createElement('div'));
		const firstButton = firstDialog.appendChild(document.createElement('button'));
		for (const element of [firstDialog, firstButton]) {
			element.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
		}
		const firstAction = focusTrap(firstDialog);
		await Promise.resolve();
		const secondDialog = document.body.appendChild(document.createElement('div'));
		const secondButton = secondDialog.appendChild(document.createElement('button'));
		for (const element of [secondDialog, secondButton]) {
			element.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
		}
		const secondAction = focusTrap(secondDialog);
		await Promise.resolve();

		firstButton.focus();
		await Promise.resolve();
		expect(document.activeElement).toBe(firstButton);
		expect(isActiveFocusTrapTarget(firstButton)).toBe(true);

		secondAction.destroy();
		expect(document.activeElement).toBe(firstButton);
		firstAction.destroy();
	});

	it('does not restore focus when an inactive trap is destroyed', async () => {
		const firstDialog = document.body.appendChild(document.createElement('div'));
		const firstButton = firstDialog.appendChild(document.createElement('button'));
		const secondDialog = document.body.appendChild(document.createElement('div'));
		const secondButton = secondDialog.appendChild(document.createElement('button'));
		for (const element of [firstDialog, firstButton, secondDialog, secondButton]) {
			element.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
		}
		const firstAction = focusTrap(firstDialog);
		await Promise.resolve();
		const secondAction = focusTrap(secondDialog);
		await Promise.resolve();

		firstAction.destroy();

		expect(document.activeElement).toBe(secondButton);
		secondAction.destroy();
	});

	it('identifies event targets in only the active trap', async () => {
		const first = document.body.appendChild(document.createElement('div'));
		const firstButton = first.appendChild(document.createElement('button'));
		const firstAction = focusTrap(first);
		const second = document.body.appendChild(document.createElement('div'));
		const secondButton = second.appendChild(document.createElement('button'));
		const secondAction = focusTrap(second);
		await Promise.resolve();

		expect(isActiveFocusTrapTarget(firstButton)).toBe(false);
		expect(isActiveFocusTrapTarget(secondButton)).toBe(true);
		secondAction.destroy();
		firstAction.destroy();
	});
});
