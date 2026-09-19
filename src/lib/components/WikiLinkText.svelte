<!--
  Render Markdown as Svelte elements, never injected HTML. Entity mentions
  reuse EntityLink navigation; code and raw HTML remain literal text.
-->

<script lang="ts">
	import { parseWikiLinks } from '$lib/wiki-links.js';
	import { entities } from '$lib/stores/entities.js';
	import { markdown, markdownHref } from '$lib/markdown.js';
	import { decodeHTMLStrict } from 'entities';
	import type { Token } from 'marked';
	import EntityLink from './EntityLink.svelte';

	interface Props {
		body: string;
		renderMarkdown?: boolean;
		/** Rendered when `body` is empty/falsy. */
		placeholder?: string;
	}
	const { body, renderMarkdown = false, placeholder = '—' }: Props = $props();

	const byName = $derived(new Map($entities.map((e) => [e.name.toLowerCase(), e])));
	const tokens = $derived(renderMarkdown ? markdown.lexer(body ?? '') : []);
	const segments = $derived(renderMarkdown ? [] : parseWikiLinks(body ?? '', $entities));
</script>

{#snippet renderTokens(items: Token[], links = true)}
	{#each items as token}
		{#if token.type === 'wikilink'}
			{@const entity = byName.get(token.text.toLowerCase())}
			{#if entity && links}<EntityLink id={entity.id} name={token.text} />
			{:else if entity}{token.raw}
			{:else}<span class="wiki-link-unknown" title="No entity named '{token.text}'">{token.raw}</span>{/if}
		{:else if token.type === 'heading'}
			<svelte:element this={`h${Math.min(token.depth + 1, 6)}`}>{@render renderTokens(token.tokens ?? [], links)}</svelte:element>
		{:else if token.type === 'paragraph'}
			<p>{@render renderTokens(token.tokens ?? [], links)}</p>
		{:else if token.type === 'strong' || token.type === 'em' || token.type === 'del' || token.type === 'blockquote'}
			<svelte:element this={token.type}>{@render renderTokens(token.tokens ?? [], links)}</svelte:element>
		{:else if token.type === 'list'}
			<svelte:element this={token.ordered ? 'ol' : 'ul'} start={token.ordered ? token.start : undefined}>
				{#each token.items as item}<li>{@render renderTokens(item.tokens, links)}</li>{/each}
			</svelte:element>
		{:else if token.type === 'checkbox'}
			<input type="checkbox" checked={token.checked} disabled aria-label={token.checked ? 'Completed task' : 'Incomplete task'} />
		{:else if token.type === 'code'}
			<pre><code>{token.text}</code></pre>
		{:else if token.type === 'codespan'}
			<code>{token.text}</code>
		{:else if token.type === 'br'}<br />
		{:else if token.type === 'hr'}<hr />
		{:else if token.type === 'link' || token.type === 'image'}
			{@const href = markdownHref(token.href, token.type === 'link' && token.autolink)}
			{#if href && links}
				<a {href} title={token.title ? decodeHTMLStrict(token.title) : undefined} target="_blank" rel="noopener noreferrer">{@render renderTokens(token.tokens ?? [], false)}</a>
			{:else}{@render renderTokens(token.tokens ?? [], false)}{/if}
		{:else if token.type === 'table'}
			<div class="table-scroll"><table>
				<thead><tr>{#each token.header as cell}<th style:text-align={cell.align}>{@render renderTokens(cell.tokens, links)}</th>{/each}</tr></thead>
				<tbody>{#each token.rows as row}<tr>{#each row as cell}<td style:text-align={cell.align}>{@render renderTokens(cell.tokens, links)}</td>{/each}</tr>{/each}</tbody>
			</table></div>
		{:else if token.type === 'text' && token.tokens}
			{@render renderTokens(token.tokens, links)}
		{:else if token.type === 'text'}{decodeHTMLStrict(token.text)}
		{:else if token.type !== 'space' && token.type !== 'def'}{'text' in token ? token.text : token.raw}
		{/if}
	{/each}
{/snippet}

{#if !body}
	<span class="wiki-link-empty">{placeholder}</span>
{:else if renderMarkdown}
	<div class="wiki-link-text">{@render renderTokens(tokens)}</div>
{:else}
	<span class="wiki-link-plain">
		{#each segments as seg}
			{#if seg.kind === 'text'}<span>{seg.text}</span>
			{:else if seg.entity}<EntityLink id={seg.entity.id} name={seg.name} />
			{:else}<span class="wiki-link-unknown" title="No entity named '{seg.name}'">{seg.raw}</span>{/if}
		{/each}
	</span>
{/if}

<style>
	.wiki-link-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
	.wiki-link-text {
		white-space: normal;
		overflow-wrap: anywhere;
		line-height: 1.6;
	}
	.wiki-link-text :global(p) { margin: 0 0 0.75em; }
	.wiki-link-text :global(:last-child) { margin-bottom: 0; }
	.wiki-link-text :global(h2), .wiki-link-text :global(h3), .wiki-link-text :global(h4), .wiki-link-text :global(h5), .wiki-link-text :global(h6) { margin: 1em 0 0.4em; line-height: 1.3; font-weight: 600; }
	.wiki-link-text :global(h2) { font-size: 1.5em; }
	.wiki-link-text :global(h3) { font-size: 1.25em; }
	.wiki-link-text :global(ul), .wiki-link-text :global(ol) { padding-left: 1.5em; margin: 0.5em 0; }
	.wiki-link-text :global(blockquote) { margin: 0.75em 0; padding-left: 1em; border-left: 2px solid var(--color-border); color: var(--color-text-muted); }
	pre { overflow-x: auto; padding: 0.75em; background: var(--color-surface-2); white-space: pre; }
	code { font-family: monospace; }
	a { color: var(--color-accent); text-decoration: underline; }
	.table-scroll { overflow-x: auto; }
	table { border-collapse: collapse; }
	th, td { padding: 0.3em 0.6em; border: 1px solid var(--color-border); }
	.wiki-link-empty {
		color: var(--color-text-muted);
	}
	.wiki-link-unknown {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
</style>
