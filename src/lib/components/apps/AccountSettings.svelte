<script lang="ts">
  import { authClient } from '$lib/auth-client.js';
  import { closeWorkspaces } from '$lib/workspace-session.js';
  import { failedWrites } from '$lib/stores/pending-writes.js';
  import { onAuthChange } from '$lib/os/preferences-sync.js';

  let { user }: { user: NonNullable<App.Locals['user']> } = $props();
  let signingOut = $state(false);
  let error = $state('');

  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    error = '';
    let leaving = false;
    try {
      await closeWorkspaces(async () => {
        const result = await authClient.signOut();
        if (result.error) throw new Error(result.error.message ?? "Couldn't sign out. Try again.");
        await onAuthChange('logout');
      });
      leaving = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Couldn't sign out. Try again.";
    } finally {
      if (!leaving) {
        signingOut = false;
      }
    }
  }
</script>

<h2>Account</h2>
<p>{user.name}</p>
<p class="email">{user.email}</p>
<p>Signing out saves pending notes and preferences, then closes this workspace.</p>
<button type="button" disabled={signingOut} onclick={signOut}>Sign out</button>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if $failedWrites.length}
  <p>These changes failed to save:</p>
  <ul>{#each $failedWrites as failure}<li>{failure}</li>{/each}</ul>
  <button type="button" onclick={() => failedWrites.set([])}>Acknowledge failed changes</button>
  <p>This clears the failure notice. It does not retry or save those changes.</p>
{/if}

<style>
  h2 { margin: 0 0 16px; font-size: 18px; }
  p { line-height: 1.5; }
  .email { overflow-wrap: anywhere; color: var(--color-text-muted); }
  button { padding: 8px 14px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text); cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: wait; }
  .error { color: var(--color-danger, #dc5555); }
</style>
