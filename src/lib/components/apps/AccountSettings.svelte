<script lang="ts">
  import { authClient } from '$lib/auth-client.js';
  import { notesStore } from '$lib/stores/notes.js';
  import { flushPendingPreferences, onAuthChange } from '$lib/os/preferences-sync.js';

  let { user }: { user: NonNullable<App.Locals['user']> } = $props();
  let signingOut = $state(false);
  let error = $state('');
  let progressDialog: HTMLDialogElement;

  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    error = '';
    progressDialog.showModal();
    let leaving = false;
    try {
      if (!await notesStore.flushPendingChanges()) {
        throw new Error("Couldn't save your notes. Check Notes and retry before signing out.");
      }
      await flushPendingPreferences();
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? "Couldn't sign out. Try again.");
      await onAuthChange('logout');
      const channel = new BroadcastChannel('betwixt-auth');
      channel.postMessage('logout');
      channel.close();
      // A full navigation clears every story store and open editor from memory.
      window.location.replace('/auth/login');
      leaving = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Couldn't sign out. Try again.";
    } finally {
      if (!leaving) {
        signingOut = false;
        progressDialog.close();
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

<dialog bind:this={progressDialog} aria-label="Signing out" oncancel={(event) => event.preventDefault()}>
  <p role="status">Saving changes and signing out...</p>
</dialog>

<style>
  h2 { margin: 0 0 16px; font-size: 18px; }
  p { line-height: 1.5; }
  .email { overflow-wrap: anywhere; color: var(--color-text-muted); }
  button { padding: 8px 14px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text); cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: wait; }
  .error { color: var(--color-danger, #dc5555); }
  dialog { border: 1px solid var(--color-border); border-radius: 8px; padding: 16px 24px; background: var(--color-surface); color: var(--color-text); }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
</style>
