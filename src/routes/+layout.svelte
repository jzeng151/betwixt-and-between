<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<!-- Chrome still probes /favicon.ico even with an SVG icon declared; this
	     empty alternate suppresses the 404. -->
	<link rel="alternate icon" type="image/x-icon" href="data:," />
</svelte:head>

{@render children()}
