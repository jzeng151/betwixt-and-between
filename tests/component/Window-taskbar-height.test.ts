import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Window from '$lib/os/Window.svelte';
import { windowStore } from '$lib/os/windows-store.js';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Window keyboard movement', () => {
	it('uses the configured taskbar height as the lower boundary', async () => {
		Object.defineProperties(window, {
			innerWidth: { value: 800, configurable: true },
			innerHeight: { value: 600, configurable: true }
		});
		vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
			getPropertyValue: () => '44px'
		} as unknown as CSSStyleDeclaration);
		const move = vi.spyOn(windowStore, 'move').mockImplementation(() => {});
		const view = render(Window, {
			props: {
				id: 'window-1', title: 'Test', x: 100, y: 350, width: 300, height: 200,
				zIndex: 1, minimized: false, maximized: false
			}
		});

		await fireEvent.keyDown(view.getByRole('toolbar'), { key: 'ArrowDown', altKey: true });

		expect(move).toHaveBeenCalledWith('window-1', 100, 356);
	});

	it('promotes the fallback window in the window store', async () => {
		const hiddenOverview = document.body.appendChild(document.createElement('main'));
		hiddenOverview.setAttribute('aria-hidden', 'true');
		const opener = hiddenOverview.appendChild(document.createElement('button'));
		opener.focus();
		const focus = vi.spyOn(windowStore, 'focus').mockImplementation(() => {});
		const view = render(Window, {
			props: {
				id: 'window-1', title: 'Test', x: 0, y: 0, width: 300, height: 200,
				zIndex: 1, minimized: false, maximized: false
			}
		});
		const fallback = document.body.appendChild(document.createElement('div'));
		fallback.className = 'window';
		fallback.dataset.windowId = 'window-2';
		fallback.style.zIndex = '2';
		fallback.tabIndex = -1;

		await fireEvent.click(view.getByRole('button', { name: 'Minimize' }));
		await Promise.resolve();

		expect(focus).toHaveBeenCalledWith('window-2');
		expect(fallback).toHaveFocus();
		fallback.remove();
		hiddenOverview.remove();
	});

	it('promotes the window owning a valid return-focus target', async () => {
		const parent = document.body.appendChild(document.createElement('div'));
		parent.className = 'window';
		parent.dataset.windowId = 'window-parent';
		const opener = parent.appendChild(document.createElement('button'));
		opener.focus();
		const focus = vi.spyOn(windowStore, 'focus').mockImplementation(() => {});
		const view = render(Window, {
			props: {
				id: 'window-child', title: 'Child', x: 0, y: 0, width: 300, height: 200,
				zIndex: 2, minimized: false, maximized: false
			}
		});

		await fireEvent.click(view.getByRole('button', { name: 'Minimize' }));
		await Promise.resolve();

		expect(focus).toHaveBeenCalledWith('window-parent');
		expect(opener).toHaveFocus();
		parent.remove();
	});
});
