type FocusTrapOptions = {
	onEscape?: () => void;
};

let nextReturnFocus: HTMLElement | null = null;
const trapStack: HTMLElement[] = [];

export function setNextFocusTrapReturn(element: HTMLElement | null) {
	nextReturnFocus = element?.isConnected ? element : null;
}

export function clearNextFocusTrapReturn() {
	nextReturnFocus = null;
}

export function takeNextFocusReturn(fallback: HTMLElement | null): HTMLElement | null {
	const returnFocus = nextReturnFocus ?? fallback;
	nextReturnFocus = null;
	return returnFocus;
}

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
	const returnFocus = takeNextFocusReturn(
		document.activeElement instanceof HTMLElement ? document.activeElement : null
	);
	let currentOptions = options;
	trapStack.push(node);
	const isActive = () => trapStack.at(-1) === node;
	function focusFirst() {
		if (!isActive()) return;
		focusableChildren(node)[0]?.focus() ?? node.focus();
	}

	queueMicrotask(focusFirst);

	function onKeydown(event: KeyboardEvent) {
		if (!isActive()) return;
		if (event.key === 'Escape' && currentOptions.onEscape) {
			if (event.target instanceof Element && event.target.closest('[data-escape-contained]')) return;
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
		if (!items.includes(document.activeElement as HTMLElement)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		} else if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onFocusIn(event: FocusEvent) {
		if (isActive() && !node.contains(event.target as Node)) queueMicrotask(focusFirst);
	}

	const observer = new MutationObserver(() => {
		queueMicrotask(() => {
			if (!isActive()) return;
			const active = document.activeElement;
			if (active === node) return;
			if (!(active instanceof HTMLElement) || !focusableChildren(node).includes(active)) focusFirst();
		});
	});
	observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'tabindex', 'hidden'] });

	node.addEventListener('keydown', onKeydown);
	document.addEventListener('focusin', onFocusIn);

	return {
		update(next: FocusTrapOptions = {}) {
			currentOptions = next;
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			document.removeEventListener('focusin', onFocusIn);
			observer.disconnect();
			const index = trapStack.lastIndexOf(node);
			if (index >= 0) trapStack.splice(index, 1);
			if (returnFocus?.isConnected) returnFocus.focus();
		}
	};
}
