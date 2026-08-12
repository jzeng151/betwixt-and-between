<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap.js';

	// Drill-down CTA: a child Location has no map yet — offer to create one.
	// Styles come from WorldMap.svelte's :global(.modal-*) rules so the modal
	// matches the rest of the app's modal chrome without duplicating CSS.

	let {
		offer,
		onAccept,
		onDismiss
	}: {
		offer: { childId: string; childName: string };
		onAccept: () => void;
		onDismiss: () => void;
	} = $props();
</script>

<div
	class="modal-overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="create-map-offer-title"
	tabindex="-1"
	use:focusTrap={{ onEscape: onDismiss }}
>
	<div class="modal-content">
		<h3 id="create-map-offer-title">No map for {offer.childName} yet</h3>
		<p class="variant-help">
			Drilling in opens the sublocation's map. <strong>{offer.childName}</strong>
			doesn't have one — want to create one?
		</p>
		<div class="modal-actions">
			<button class="btn-secondary" onclick={onDismiss}>Not now</button>
			<button class="btn-primary" onclick={onAccept}>
				Create a map for {offer.childName}
			</button>
		</div>
	</div>
</div>
