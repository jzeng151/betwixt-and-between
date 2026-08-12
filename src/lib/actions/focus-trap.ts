type FocusTrapOptions = {
	onEscape?: () => void;
};

const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableChildren(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => el.getClientRects().length > 0 || el === document.activeElement
	);
}

export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}) {
	const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	let currentOptions = options;

	queueMicrotask(() => focusableChildren(node)[0]?.focus() ?? node.focus());

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && currentOptions.onEscape) {
			event.preventDefault();
			event.stopPropagation();
			currentOptions.onEscape();
			return;
		}
		if (event.key !== 'Tab') return;

		const items = focusableChildren(node);
		if (items.length === 0) {
			event.preventDefault();
			node.focus();
			return;
		}

		const first = items[0];
		const last = items.at(-1)!;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		update(next: FocusTrapOptions = {}) {
			currentOptions = next;
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			if (returnFocus?.isConnected) returnFocus.focus();
		}
	};
}
