<script lang="ts">
	let { children } = $props();
</script>

<div class="auth-layout">
	{@render children()}
</div>

<style>
	.auth-layout {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 1rem;
	}
</style>
