<script lang="ts">
	/**
	 * Segment of an impact line. Strings render as auto-escaped text;
	 * `{ bold }` renders as `<strong>` wrapping auto-escaped text. No raw
	 * HTML passes through, so user-supplied values (entity names, etc.)
	 * cannot inject markup.
	 */
	export type DeleteImpactPart = string | { bold: string };
	export type DeleteImpact = {
		parts: DeleteImpactPart[];
		/** Yellow warning treatment instead of red. */
		warn?: boolean;
	};

	let {
		name,
		impacts = [],
		confirmLabel,
		deleting = false,
		error = '',
		onConfirm,
		onCancel
	}: {
		name: string;
		impacts?: DeleteImpact[];
		confirmLabel: string;
		deleting?: boolean;
		error?: string;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !deleting) onCancel();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="delete-backdrop"
	role="presentation"
	onclick={() => !deleting && onCancel()}
></div>
<div class="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
	<h2 id="delete-title" class="delete-title">
		Delete <strong>{name}</strong>?
	</h2>
	<p class="delete-lead">
		This <strong>permanently</strong> removes the item and everything that references it.
		There is no undo.
	</p>
	{#if impacts.length > 0}
		<ul class="delete-impact">
			{#each impacts as impact}
				<li class:impact-warn={impact.warn}>
					<span class="impact-icon">{impact.warn ? '⚠' : '✕'}</span>
					<span>
						{#each impact.parts as part}{#if typeof part === 'string'}{part}{:else}<strong>{part.bold}</strong>{/if}{/each}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}
		<p class="delete-error" role="alert">{error}</p>
	{/if}
	<div class="delete-actions">
		<button type="button" class="delete-cancel" disabled={deleting} onclick={onCancel}
			>Cancel</button
		>
		<button
			type="button"
			class="delete-confirm-btn"
			disabled={deleting}
			onclick={onConfirm}>{deleting ? 'Deleting…' : confirmLabel}</button
		>
	</div>
</div>

<style>
	.delete-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 9999;
		cursor: pointer;
	}
	.delete-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 10000;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
		padding: 22px 24px;
		width: min(440px, calc(100vw - 48px));
		color: var(--color-text);
		font-family: var(--font-ui);
	}
	.delete-title {
		margin: 0 0 8px;
		font-family: var(--font-display, var(--font-ui));
		font-size: 19px;
		font-weight: 500;
		color: var(--color-text);
		line-height: 1.3;
	}
	.delete-title strong {
		color: var(--color-text);
		font-weight: 600;
	}
	.delete-lead {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.delete-lead strong {
		color: #ef4444;
		font-weight: 600;
	}
	.delete-impact {
		list-style: none;
		margin: 0 0 16px;
		padding: 12px 14px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.delete-impact li {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text);
	}
	.delete-impact .impact-icon {
		font-size: 11px;
		color: #ef4444;
		line-height: 1.4;
		flex-shrink: 0;
		width: 14px;
		text-align: center;
	}
	.delete-impact .impact-warn {
		color: #fbbf24;
	}
	.delete-impact .impact-warn .impact-icon {
		color: #fbbf24;
	}
	.delete-error {
		margin: 0 0 12px;
		padding: 8px 10px;
		background: color-mix(in srgb, #ef4444 12%, transparent);
		border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
		border-radius: 4px;
		font-size: 12px;
		color: #ef4444;
	}
	.delete-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.delete-cancel {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		border-radius: 4px;
		padding: 7px 14px;
		font-size: 13px;
		font-family: var(--font-ui);
		cursor: pointer;
	}
	.delete-cancel:hover {
		color: var(--color-text);
		border-color: var(--color-text);
	}
	.delete-cancel:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.delete-confirm-btn {
		background: #ef4444;
		color: #fff;
		border: none;
		border-radius: 4px;
		padding: 7px 14px;
		font-size: 13px;
		font-family: var(--font-ui);
		font-weight: 600;
		cursor: pointer;
	}
	.delete-confirm-btn:hover {
		background: #dc2626;
	}
	.delete-confirm-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
