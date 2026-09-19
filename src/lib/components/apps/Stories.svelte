<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import { drainPendingCommit } from '$lib/util/pending-commit.js';
	import { flushPendingWrites, trackWrite } from '$lib/stores/pending-writes.js';
	import { notesStore } from '$lib/stores/notes.js';
	import { flushPendingPreferences } from '$lib/os/preferences-sync.js';

	let stories = $state<Array<{ id: string; name: string }>>([]);
	let name = $state('');
	let newName = $state('');
	let error = $state('');
	let loading = $state(true);
	let busy = $state(false);
	const createRetry = Symbol('create-story');
	const renameRetry = Symbol('rename-story');
	let progress: HTMLDialogElement;
	const current = $derived($page.data.story);
	$effect(() => { name = current.name; });

	async function load() {
		loading = true;
		error = '';
		try {
			const response = await fetch('/api/stories');
			if (!response.ok) throw new Error('Could not load stories. Try again.');
			stories = await response.json();
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load stories.'; }
		finally { loading = false; }
	}
	onMount(load);

	async function save(create: boolean) {
		if (busy || loading) return;
		busy = true;
		error = '';
		try {
			await trackWrite(fetch(create ? '/api/stories' : `/api/stories/${current.id}`, {
				method: create ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: create ? newName : name })
			}).then(async response => {
				if (!response.ok) throw new Error((await response.json()).message ?? 'Could not save the story name.');
			}), create ? createRetry : renameRetry);
			if (create) newName = '';
			await Promise.all([load(), invalidateAll()]);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save the story name.'; }
		finally { busy = false; }
	}

	async function openStory(id: string) {
		if (busy || id === current.id) return;
		busy = true;
		error = '';
		progress.showModal();
		try {
			await drainPendingCommit(true);
			const results = await Promise.allSettled([notesStore.flushDrafts(), flushPendingPreferences()]);
			for (const result of results) {
				if (result.status === 'rejected') throw result.reason;
				if (result.value === false) throw new Error('Save or retry your notes before switching stories.');
			}
			await flushPendingWrites();
			// A fresh document clears all per-story stores and undo history. Other
			// tabs keep their URL and cannot redirect this tab's pending writes.
			window.location.replace(`/app?story=${encodeURIComponent(id)}`);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save changes. Story switching was cancelled.';
			progress.close();
			busy = false;
		}
	}
</script>

<h2>Stories</h2>
<p>Stories keep data and open windows separate. Appearance profiles are shared.</p>
<form onsubmit={(event) => { event.preventDefault(); void save(true); }}>
	<label for="new-story-name">New story name</label>
	<div class="row"><input id="new-story-name" bind:value={newName} required maxlength="100" disabled={busy || loading} /><button disabled={busy || loading || !newName.trim()}>Create story</button></div>
</form>
{#if loading}<p role="status">Loading stories...</p>
{:else}
	<ul>{#each stories as story}<li><span>{story.name}</span>{#if story.id === current.id}<span class="current">Current story</span>{:else}<button disabled={busy} onclick={() => openStory(story.id)} aria-label={`Open ${story.name}`}>Open</button>{/if}</li>{/each}</ul>
{/if}

<form onsubmit={(event) => { event.preventDefault(); void save(false); }}>
	<label for="story-name">Current story name</label>
	<div class="row"><input id="story-name" bind:value={name} required maxlength="100" disabled={busy || loading} /><button disabled={busy || loading || !name.trim() || name.trim() === current.name}>Rename</button></div>
</form>
<p>Switching saves pending changes in this tab. Other tabs keep their current story. Existing data is in your first story.</p>
{#if error}<p role="alert" class="error">{error}</p>{#if !stories.length}<button onclick={load} disabled={busy || loading}>Retry loading stories</button>{/if}{/if}
<dialog bind:this={progress} aria-label="Switching stories" oncancel={(event) => event.preventDefault()} onkeydown={(event) => event.stopPropagation()}><p role="status">Saving changes before switching stories...</p></dialog>

<style>
	h2 { margin: 0 0 16px; font-size: 18px; }
	p { line-height: 1.5; }
	form { margin: 12px 0; }
	label { display: block; margin-bottom: 6px; }
	.row { display: flex; gap: 8px; }
	input { min-width: 0; flex: 1; padding: 8px; border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); background: var(--color-surface); }
	button { padding: 8px 14px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text); cursor: pointer; }
	button:disabled { opacity: 0.6; cursor: default; }
	ul { list-style: none; padding: 0; }
	li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--color-border); }
	li > span:first-child { overflow-wrap: anywhere; }
	.current { color: var(--color-text-muted); white-space: nowrap; }
	.error { color: var(--color-danger); }
	dialog { border: 1px solid var(--color-border); border-radius: 8px; padding: 16px 24px; background: var(--color-surface); color: var(--color-text); }
	dialog::backdrop { background: rgb(0 0 0 / 45%); }
</style>
