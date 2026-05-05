<!--
  WikiLinkText — renders a body string with `[[Name]]` markers resolved
  to clickable EntityLink chips. Unknown names render with a grey
  strikethrough fallback per design specs Pass 2 ("Error" row).

  Subscribes to the entities store for the resolution pool so callers
  don't have to thread it through.
-->

<script lang="ts">
	import { entities } from '$lib/stores/entities.js';
	import { parseWikiLinks } from '$lib/wiki-links.js';
	import EntityLink from './EntityLink.svelte';

	interface Props {
		body: string;
		/** Rendered when `body` is empty/falsy. */
		placeholder?: string;
	}
	const { body, placeholder = '—' }: Props = $props();

	const pool = $derived(
		$entities.map((e) => ({ id: e.id, name: e.name, type: e.type }))
	);
	const segments = $derived(parseWikiLinks(body ?? '', pool));
</script>

{#if !body}
	<span class="wiki-link-empty">{placeholder}</span>
{:else}
	<span class="wiki-link-text">
		{#each segments as seg, i (i)}
			{#if seg.kind === 'text'}<span>{seg.text}</span>
			{:else if seg.entity}<EntityLink id={seg.entity.id} name={seg.name} />
			{:else}<span class="wiki-link-unknown" title="No entity named '{seg.name}'">{seg.raw}</span>
			{/if}
		{/each}
	</span>
{/if}

<style>
	.wiki-link-text {
		white-space: pre-wrap;
		word-wrap: break-word;
	}
	.wiki-link-empty {
		color: var(--color-text-muted);
	}
	.wiki-link-unknown {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
</style>
