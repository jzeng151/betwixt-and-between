<script lang="ts">
	let downloading = $state(false);
	let error = $state('');
	let downloaded = $state(false);

	async function download() {
		if (downloading) return;
		downloading = true;
		error = '';
		downloaded = false;
		try {
			const response = await fetch('/api/export', { signal: AbortSignal.timeout(60_000) });
			if (!response.ok) {
				const detail = await response.json().catch(() => null);
				throw new Error(detail?.message ?? 'Could not export your saved data. Try again.');
			}
			const url = URL.createObjectURL(await response.blob());
			const link = document.createElement('a');
			link.href = url;
			link.download = `betwixt-story-${new Date().toISOString().slice(0, 10)}.json`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			downloaded = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not export your saved data. Try again.';
		} finally {
			downloading = false;
		}
	}
</script>

<h2>Export story data</h2>
<p>Download the saved data from all stories and preferences for this account as a JSON file.</p>
<p>Finish saving edits before downloading. Unsaved drafts are not included. Uploaded and external images remain links, and importing this file is not yet supported.</p>
<button type="button" disabled={downloading} onclick={download}>{downloading ? 'Preparing download…' : 'Download saved data'}</button>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if downloaded}<p role="status">Download started.</p>{/if}

<style>
	h2 { margin: 0 0 16px; font-size: 18px; }
	p { line-height: 1.5; }
	button { padding: 8px 14px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text); cursor: pointer; }
	button:disabled { opacity: 0.6; cursor: wait; }
	.error { color: var(--color-danger); }
</style>
