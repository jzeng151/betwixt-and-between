<script lang="ts">
	import { onMount } from 'svelte';
	import { startWorkspaceSession, workspaceClosing, workspaceReady, workspaceSignedOut } from '$lib/workspace-session.js';
	let { children } = $props();
	let progress: HTMLDialogElement;
	onMount(startWorkspaceSession);
	$effect(() => {
		if (!progress) return;
		if ($workspaceClosing && !progress.open) progress.showModal();
		else if (!$workspaceClosing && progress.open) progress.close();
	});
</script>

{#if !$workspaceSignedOut && $workspaceReady}{@render children()}{/if}
<dialog bind:this={progress} aria-label="Signing out" onkeydown={(event) => event.stopPropagation()} oncancel={(event) => event.preventDefault()}>
	<p role="status">Saving changes in your open tabs and signing out...</p>
</dialog>

<style>
	dialog { border: 1px solid var(--color-border); border-radius: 8px; padding: 16px 24px; background: var(--color-surface); color: var(--color-text); }
	dialog::backdrop { background: rgb(0 0 0 / 45%); }
</style>
