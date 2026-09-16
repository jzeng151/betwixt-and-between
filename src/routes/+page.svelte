<script lang="ts">
	import daylightSection from '$lib/assets/daylight-story-section.webp';
	import daylightSectionSmall from '$lib/assets/daylight-story-section-small.webp';
</script>

<svelte:head>
	<title>Betwixt and Between — See the whole story</title>
	<meta
		name="description"
		content="Characters, places, scenes, and events share one connected worldbuilding workspace."
	/>
</svelte:head>

<a href="#story" class="skip-link">Skip to content</a>

<main class="daylight">

	<img class="section-image" src={daylightSection} srcset="{daylightSectionSmall} 800w, {daylightSection} 1672w" sizes="100vw" alt="" aria-hidden="true" />
	<div class="wash" aria-hidden="true"></div>

	<header class="topbar">
		<a class="wordmark" href="/">Betwixt &amp; Between</a>
		<p>One structure <span aria-hidden="true">·</span> four views</p>
	</header>

	<section class="story" id="story" aria-labelledby="story-heading">
		<h1 id="story-heading">See the whole<br />story in section.</h1>

		<div class="connection" aria-label="Illustrative story connection">
			<p>Illustrative story connection</p>
			<div>
				<strong>Elara Voss</strong>
				<span>located at</span>
				<strong>Ashenveil</strong>
			</div>
			<div class="sample-views">
				<span>Story Graph</span><i aria-hidden="true">→</i>
				<span>World Map</span><i aria-hidden="true">→</i>
				<span>Act II Timeline</span>
			</div>
			<p class="sample-note">An example of a connected story, not a playable demo.</p>
		</div>

		<p class="intro">
			Characters, places, scenes, and events share one connected structure. Move through the
			graph, timeline, map, and wiki without rebuilding the same world four times.
		</p>

		<a class="primary-action" href="/app">Open the workspace</a>

		<div class="question">
			<h2>Hold a question in the light</h2>
			<p>Who was in Ashenveil during the second act, and why?</p>
		</div>

		<div class="views">
			<span>Story Graph</span>
			<span>Timeline</span>
			<span>World Map</span>
			<span>Wiki</span>
		</div>
	</section>

	<p class="section-mark">Section A–A <span aria-hidden="true">·</span> East Gate <span aria-hidden="true">·</span> 08:12</p>
</main>

<style>
	.daylight :global(::selection) {
		background: #dca536;
		color: #1f211d;
	}

	.skip-link {
		position: fixed;
		z-index: 20;
		top: 12px;
		left: 12px;
		padding: 10px 14px;
		background: #20221e;
		color: #f3efe4;
		font: 600 12px/1 'Inter', sans-serif;
		transform: translateY(-180%);
	}

	.skip-link:focus {
		transform: translateY(0);
	}

	.daylight {
		position: relative;
		isolation: isolate;
		min-height: 100svh;
		overflow: hidden;
		background: #eeece4;
		color: #20211d;
	}

	.section-image,
	.wash {
		position: absolute;
		z-index: -2;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.section-image {
		object-fit: cover;
		object-position: center;
	}

	.wash {
		z-index: -1;
		background: linear-gradient(90deg, rgba(239, 237, 229, 0.78) 0%, rgba(239, 237, 229, 0.3) 45%, transparent 68%);
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 70px;
		padding: 0 4vw;
		border-bottom: 1px solid rgba(30, 31, 28, 0.24);
	}

	.wordmark,
	.connection p,
	.connection span,
	.question h2,
	.section-mark {
		font-family: 'Barlow Condensed', 'Arial Narrow', sans-serif;
		font-weight: 600;
		text-transform: uppercase;
	}

	.wordmark {
		color: inherit;
		font-size: 17px;
		letter-spacing: 0.06em;
		text-decoration: none;
	}

	.topbar p {
		font: 600 11px/1 'Inter', sans-serif;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	.story {
		width: min(42rem, 48vw);
		padding: clamp(52px, 8vh, 96px) 0 44px 4vw;
	}

	h1 {
		max-width: 670px;
		margin: 0 0 26px;
		font: italic 600 clamp(3.8rem, 7vw, 6rem) / 0.87 'Barlow Condensed', 'Arial Narrow', sans-serif;
		letter-spacing: -0.03em;
		text-transform: uppercase;
		text-wrap: balance;
	}

	.connection {
		max-width: 460px;
		margin-bottom: 24px;
		padding: 11px 0;
		border-block: 1px solid rgba(30, 31, 28, 0.34);
	}

	.connection p {
		margin-bottom: 5px;
		font-size: 11px;
		letter-spacing: 0.13em;
		opacity: 0.72;
	}

	.connection div {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 8px;
	}

	.connection div {
		margin-bottom: 4px;
	}

	.connection strong {
		font-weight: 700;
	}

	.connection div > span {
		font-size: 11px;
		letter-spacing: 0.08em;
	}

	.connection .sample-views {
		font-size: 12px;
		opacity: 0.76;
	}

	.connection i {
		font-style: normal;
	}

	.connection .sample-note {
		margin: 10px 0 0;
		font: 400 12px/1.5 'Inter', sans-serif;
		letter-spacing: normal;
		text-transform: none;
		opacity: 1;
	}

	.intro {
		max-width: 440px;
		margin-bottom: 28px;
		font: 400 15px/1.65 'Inter', sans-serif;
	}

	.primary-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0 20px;
		background: #21231f;
		border: 1px solid #21231f;
		color: #f4f0e5;
		font: 700 14px/1 'Inter', sans-serif;
		text-decoration: none;
		transition: background 180ms ease, color 180ms ease, transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.primary-action:hover {
		background: #d9a53c;
		color: #20211d;
		transform: translateY(-2px);
	}

	.primary-action:active {
		transform: translateY(1px);
	}

	.question {
		max-width: 460px;
		margin-top: 40px;
		padding-top: 16px;
		border-top: 1px solid rgba(30, 31, 28, 0.34);
	}

	.question h2 {
		margin-bottom: 5px;
		font-size: 13px;
		letter-spacing: 0.1em;
	}

	.question p {
		font: 400 13px/1.55 'Inter', sans-serif;
	}

	.views {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 18px;
		margin-top: 16px;
		font: 500 12px/1.4 'Inter', sans-serif;
	}

	.section-mark {
		position: absolute;
		right: 3vw;
		bottom: 30px;
		padding: 10px 12px;
		background: rgba(239, 237, 229, 0.88);
		font-size: 11px;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	:global(.daylight a:focus-visible) {
		outline: 3px solid #a8710f !important;
		outline-offset: 4px;
	}

	@media (max-width: 800px) {
		.daylight {
			min-height: 100svh;
			overflow: visible;
		}

		.section-image {
			position: fixed;
			object-position: 66% center;
			opacity: 0.34;
		}

		.wash {
			position: fixed;
			background: rgba(239, 237, 229, 0.55);
		}

		.topbar {
			height: 60px;
			padding-inline: 20px;
		}

		.topbar p {
			font-size: 9px;
		}

		.story {
			width: auto;
			padding: 48px 20px;
		}

		h1 {
			font-size: clamp(3.2rem, 15vw, 5rem);
		}

		.intro {
			font-weight: 500;
		}

		.section-mark {
			display: none;
		}
	}

	@media (max-width: 430px) {
		.topbar p {
			display: none;
		}

		.story {
			padding-top: 38px;
		}

		.connection .sample-views {
			gap: 4px 6px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-action {
			transition: none;
		}
	}
</style>
