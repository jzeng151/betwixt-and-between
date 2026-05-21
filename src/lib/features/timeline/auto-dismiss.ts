// Auto-dismiss toast helper. Used by Timeline + ActsHeader for transient
// error banners that should fade after a few seconds.
//
// Why a factory: each call site keeps its own error state ($state in Svelte 5
// or a writable elsewhere), so the helper takes a setter callback rather than
// owning the state itself. Returns {show, cancel} so the caller can wire
// cancel into an onDestroy hook and not leak timer references on unmount.

export interface AutoDismiss {
	/** Set the message and start a fresh dismiss timer. Clears any prior timer
	 *  so a stale dismiss can't blank the newer message early. */
	show(msg: string): void;
	/** Clear any pending dismiss timer. Call from onDestroy. */
	cancel(): void;
}

export function createAutoDismiss(
	setter: (msg: string | null) => void,
	ms = 4000
): AutoDismiss {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return {
		show(msg: string) {
			setter(msg);
			if (timer != null) clearTimeout(timer);
			timer = setTimeout(() => {
				setter(null);
				timer = null;
			}, ms);
		},
		cancel() {
			if (timer != null) {
				clearTimeout(timer);
				timer = null;
			}
		}
	};
}
