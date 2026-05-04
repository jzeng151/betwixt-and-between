type TooltipParams = { text: string; maxWidth: number };

/**
 * Svelte action that mounts a `position: fixed` tooltip on document.body,
 * escaping any overflow-clipping ancestors (e.g. the .rows scroll container).
 * Styled via the global `.tl-bar-tooltip` class defined in IntervalRow.svelte.
 */
export function tooltip(node: HTMLElement, params: TooltipParams) {
	let el: HTMLDivElement | null = null;

	function show(e: MouseEvent) {
		if (el) return;
		el = document.createElement('div');
		el.className = 'tl-bar-tooltip';
		el.textContent = params.text;
		el.style.maxWidth = `${params.maxWidth}px`;
		document.body.appendChild(el);
		reposition((e.currentTarget as HTMLElement).getBoundingClientRect());
	}

	function reposition(rect: DOMRect) {
		if (!el) return;
		el.style.left = `${rect.left + rect.width / 2}px`;
		el.style.top = `${rect.top - 8}px`;
	}

	function hide() {
		el?.remove();
		el = null;
	}

	node.addEventListener('mouseenter', show);
	node.addEventListener('mouseleave', hide);
	node.addEventListener('pointerdown', hide);

	return {
		update(p: TooltipParams) {
			params = p;
			if (el) {
				el.textContent = params.text;
				el.style.maxWidth = `${params.maxWidth}px`;
			}
		},
		destroy() {
			hide();
			node.removeEventListener('mouseenter', show);
			node.removeEventListener('mouseleave', hide);
			node.removeEventListener('pointerdown', hide);
		}
	};
}
