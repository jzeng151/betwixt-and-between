<script lang="ts">
  import { onMount } from 'svelte';
  import MiniDesktop from '$lib/components/landing/MiniDesktop.svelte';

  let activeSections = $state(new Set<string>());

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeSections.add(entry.target.id);
            activeSections = new Set(activeSections);
          }
        }
      },
      { threshold: 0.5 }
    );

    const sections = document.querySelectorAll('.theatre-section[data-panel]');
    for (const section of sections) {
      observer.observe(section);
    }

    return () => observer.disconnect();
  });

  const sections = [
    {
      id: 'characters',
      eyebrow: 'Characters',
      heading: 'Know your cast',
      body: 'Create rich character profiles. Track their relationships, aliases, and evolution across your story.',
    },
    {
      id: 'graph',
      eyebrow: 'Story Graph',
      heading: 'See every connection',
      body: 'Visualize the web of relationships between characters, locations, and events. No thread left dangling.',
    },
    {
      id: 'timeline',
      eyebrow: 'Timeline',
      heading: 'Map the arc',
      body: 'Organize events into acts and scenes. See cause and effect laid out in time.',
    },
    {
      id: 'map',
      eyebrow: 'World Map',
      heading: 'Build your world',
      body: 'Draw regions on an interactive map. Pin locations to geography, not just memory.',
    },
  ];
</script>

<svelte:head>
  <title>betwixt-and-between — Worldbuilding toolkit for novelists</title>
  <meta name="description" content="Characters, story graphs, timelines, and world maps — one workspace for your entire narrative." />
</svelte:head>

<a href="#intro" class="skip-link">Skip to content</a>

<main class="landing">
  <!-- Hero -->
  <section id="intro" class="hero">
    <div class="hero-inner">
      <p class="hero-eyebrow">betwixt-and-between</p>
      <h1 class="hero-heading">Your story,<br>fully mapped</h1>
      <p class="hero-body">Characters, story graphs, timelines, and world maps — one workspace for your entire narrative.</p>
      <a href="/app" class="cta-button">Start building</a>
    </div>
  </section>

  <!-- Scroll theatre: sticky desktop stays within this wrapper -->
  <div class="theatre-wrap">
    <div class="sticky-desktop" aria-hidden="true">
      <MiniDesktop activeSections={activeSections} />
    </div>

    {#each sections as section, i}
      <section
        id={section.id}
        class="theatre-section"
        data-panel={section.id}
      >
        <div class="theatre-inner" aria-labelledby="{section.id}-heading">
          <p class="section-eyebrow">{section.eyebrow}</p>
          <h2 id="{section.id}-heading" class="section-heading">{section.heading}</h2>
          <p class="section-body">{section.body}</p>
        </div>
      </section>
    {/each}
  </div>

  <!-- CTA -->
  <section class="cta-section">
    <h2 class="cta-heading">Ready to build your world?</h2>
    <a href="/app" class="cta-button">Start building</a>
  </section>
</main>

<style>
  .skip-link {
    position: absolute;
    top: -100%;
    left: 0;
    background: var(--color-surface);
    color: var(--color-text);
    padding: 8px 16px;
    z-index: 100;
    font-family: var(--font-ui);
    font-size: 14px;
  }

  .skip-link:focus {
    top: 0;
  }

  .landing {
    background: var(--color-desktop);
    color: var(--color-text);
    min-height: 100vh;
  }

  /* Hero */
  .hero {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 24px;
  }

  .hero-inner {
    max-width: 600px;
  }

  .hero-eyebrow {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-accent);
    margin-bottom: 16px;
  }

  .hero-heading {
    font-family: var(--font-display);
    font-size: clamp(36px, 6vw, 56px);
    font-weight: 400;
    line-height: 1.1;
    margin-bottom: 20px;
  }

  .hero-body {
    font-family: var(--font-ui);
    font-size: 16px;
    line-height: 1.6;
    color: var(--color-text-muted);
    margin-bottom: 32px;
  }

  /* CTA button */
  .cta-button {
    display: inline-block;
    background: var(--color-accent);
    color: var(--color-desktop);
    font-family: var(--font-ui);
    font-size: 16px;
    font-weight: 600;
    padding: 12px 28px;
    border-radius: 6px;
    text-decoration: none;
    transition: opacity 0.2s ease;
  }

  .cta-button:hover {
    opacity: 0.9;
  }

  .cta-button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* Theatre */
  .theatre-wrap {
    position: relative;
  }

  .theatre-section {
    min-height: 80vh;
    display: flex;
    align-items: center;
    padding: 80px 10vw;
  }

  .theatre-inner {
    max-width: 380px;
    width: 100%;
  }

  .section-eyebrow {
    font-family: var(--font-ui);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-accent);
    margin-bottom: 12px;
  }

  .section-heading {
    font-family: var(--font-display);
    font-size: clamp(28px, 4vw, 36px);
    font-weight: 400;
    line-height: 1.15;
    margin-bottom: 16px;
  }

  .section-body {
    font-family: var(--font-ui);
    font-size: 15px;
    line-height: 1.6;
    color: var(--color-text-muted);
  }

  /* Sticky desktop: hidden on mobile */
  .sticky-desktop {
    display: none;
  }

  /* Desktop: sticky mini-desktop centered, copy alternates sides */
  @media (min-width: 960px) {
    .theatre-section:nth-of-type(odd) {
      justify-content: flex-start;
      padding: 60px 4vw 60px 8vw;
    }

    .theatre-section:nth-of-type(even) {
      justify-content: flex-end;
      padding: 60px 8vw 60px 4vw;
    }

    .sticky-desktop {
      display: flex;
      align-items: center;
      justify-content: center;
      position: sticky;
      top: 0;
      height: 0;
      overflow: visible;
      pointer-events: none;
      z-index: 1;
    }

    .sticky-desktop > :global(*) {
      width: 40vw;
      max-width: 560px;
      position: relative;
      top: 40vh;
      transform: translateY(-50%);
    }
  }

  /* CTA */
  .cta-section {
    min-height: 60vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 80px 24px;
    position: relative;
    z-index: 2;
  }

  .cta-heading {
    font-family: var(--font-display);
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 400;
    margin-bottom: 24px;
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    :global(.mini-window) {
      transition: none !important;
      opacity: 1 !important;
      transform: none !important;
    }

    :global(.mini-graph),
    :global(.mini-timeline),
    :global(.mini-map) {
      transition: none !important;
      opacity: 1 !important;
    }

    :global(.mini-graph .edge),
    :global(.mini-graph .node),
    :global(.mini-graph .label),
    :global(.mini-timeline .bar),
    :global(.mini-map .region),
    :global(.mini-map .pin) {
      transition: none !important;
      opacity: 1 !important;
      transform: none !important;
      stroke-dashoffset: 0 !important;
    }
  }
</style>
