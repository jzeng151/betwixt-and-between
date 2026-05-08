<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types.js';

	// Server-driven Google button visibility (Codex P2 fix). +page.server.ts
	// reads GOOGLE_CLIENT_ID/SECRET from runtime env (the same vars buildAuth
	// uses) and passes a googleEnabled flag down. Previous code checked
	// VITE_GOOGLE_CLIENT_ID, a separate build-time env that could disagree
	// with server config and hide the button while the backend was enabled.
	let { data }: { data: PageData } = $props();

	let email = $state('');
	let loading = $state(false);
	let error = $state('');
	let sent = $state(false);
	const showGoogle = $derived(data.googleEnabled);

	async function handleMagicLink(e: Event) {
		e.preventDefault();
		loading = true;
		error = '';

		const result = await authClient.signIn.magicLink({
			email,
			callbackURL: '/app',
		});

		if (result.error) {
			error = result.error.message ?? 'Failed to send magic link';
			loading = false;
		} else {
			sent = true;
		}
	}

	async function handleGoogle() {
		await authClient.signIn.social({
			provider: 'google',
			callbackURL: '/app',
		});
	}
</script>

<div class="login-card">
	<h1>Welcome to Betwixt</h1>
	<p class="subtitle">Sign in to your writing workspace</p>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if sent}
		<div class="sent">
			<p>Check your email for a sign-in link.</p>
			<p class="hint">Click the link in the email to continue.</p>
		</div>
	{:else}
		<form onsubmit={handleMagicLink}>
			<label for="email">Email</label>
			<input
				id="email"
				type="email"
				bind:value={email}
				placeholder="you@example.com"
				required
				disabled={loading}
			/>
			<button type="submit" disabled={loading || !email}>
				{loading ? 'Sending...' : 'Send Magic Link'}
			</button>
		</form>

		{#if showGoogle}
			<div class="divider"><span>or</span></div>
			<button class="google-btn" onclick={handleGoogle} disabled={loading}>
				Sign in with Google
			</button>
		{/if}
	{/if}
</div>

<style>
	.login-card {
		background: var(--color-surface, #1a1a2e);
		border-radius: 12px;
		padding: 2rem;
		width: 100%;
		max-width: 400px;
		color: var(--color-text, #e0e0e0);
	}

	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
	}

	.subtitle {
		margin: 0 0 1.5rem;
		opacity: 0.7;
		font-size: 0.9rem;
	}

	label {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.85rem;
	}

	input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--color-border, #333);
		border-radius: 8px;
		background: var(--color-bg, #0f0f23);
		color: inherit;
		font-size: 1rem;
		margin-bottom: 1rem;
		box-sizing: border-box;
	}

	button {
		width: 100%;
		padding: 0.75rem;
		border: none;
		border-radius: 8px;
		background: var(--color-accent, #6c63ff);
		color: white;
		font-size: 1rem;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error {
		color: #ff6b6b;
		margin-bottom: 1rem;
	}

	.sent {
		text-align: center;
		padding: 1rem 0;
	}

	.hint {
		opacity: 0.7;
		font-size: 0.85rem;
	}

	.divider {
		text-align: center;
		margin: 1rem 0;
		position: relative;
	}

	.divider::before,
	.divider::after {
		content: '';
		position: absolute;
		top: 50%;
		width: 40%;
		height: 1px;
		background: var(--color-border, #333);
	}

	.divider::before { left: 0; }
	.divider::after { right: 0; }

	.divider span {
		background: var(--color-surface, #1a1a2e);
		padding: 0 0.5rem;
		font-size: 0.85rem;
		opacity: 0.7;
	}

	.google-btn {
		background: var(--color-bg, #0f0f23);
		border: 1px solid var(--color-border, #333);
		color: inherit;
	}
</style>
