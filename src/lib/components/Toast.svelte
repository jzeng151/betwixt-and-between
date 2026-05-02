<!--
  Toast — small bottom-center notification with optional draft-preview mode.

  draft-preview (D16/14A): when an entity gets deleted while the user is
  editing it elsewhere, we surface their last-typed text with a Copy-to-
  clipboard button so they can paste it back into a new entity. Truncated
  to 80 chars with an ellipsis. Auto-dismisses after 8s, can be dismissed
  manually.
-->

<script lang="ts">
	interface Props {
		kind?: 'info' | 'draft-preview';
		message: string;
		draft?: string | null;
		durationMs?: number;
		onDismiss?: () => void;
	}

	let {
		kind = 'info',
		message,
		draft = null,
		durationMs = 8000,
		onDismiss
	}: Props = $props();

	let copied = $state(false);

	$effect(() => {
		const t = setTimeout(() => onDismiss?.(), durationMs);
		return () => clearTimeout(t);
	});

	const truncated = $derived(
		draft ? (draft.length > 80 ? draft.slice(0, 80) + '…' : draft) : null
	);

	async function copy() {
		if (!draft) return;
		try {
			await navigator.clipboard.writeText(draft);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard permission denied — fall back to no-op.
		}
	}
</script>

<div class="toast" class:toast--draft={kind === 'draft-preview'} role="alert">
	<div class="toast-msg">{message}</div>
	{#if kind === 'draft-preview' && truncated}
		<div class="toast-draft">
			<span class="toast-draft-quote">"{truncated}"</span>
			<button type="button" class="toast-copy" onclick={copy}>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
	{/if}
	<button type="button" class="toast-close" aria-label="Dismiss" onclick={onDismiss}>×</button>
</div>

<style>
	.toast {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-surface-2, #1c1f28);
		border: 1px solid var(--color-border, #2a2d35);
		color: var(--color-text, #e8e0d0);
		padding: 10px 32px 10px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-family: var(--font-ui, 'Inter', sans-serif);
		max-width: 480px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		z-index: 1000;
	}
	.toast--draft {
		border-color: rgba(200, 148, 42, 0.6);
	}
	.toast-msg {
		font-weight: 500;
	}
	.toast-draft {
		margin-top: 6px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--color-text-muted, #6b7280);
	}
	.toast-draft-quote {
		font-style: italic;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.toast-copy {
		flex-shrink: 0;
		background: var(--color-accent, #c8942a);
		color: #0d0f14;
		border: none;
		border-radius: 3px;
		padding: 3px 8px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}
	.toast-copy:hover {
		filter: brightness(1.1);
	}
	.toast-close {
		position: absolute;
		top: 4px;
		right: 6px;
		background: transparent;
		border: none;
		color: var(--color-text-muted, #6b7280);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		padding: 2px 4px;
	}
	.toast-close:hover {
		color: var(--color-text, #e8e0d0);
	}
</style>
