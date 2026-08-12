<script lang="ts">
  import { windowStore } from '$lib/os/windows-store.js';
  import { entities } from '$lib/stores/entities.js';

  const hasVisibleWindows = $derived($windowStore.some((window) => !window.minimized));
  const sections = $derived([
    {
      title: 'Cast',
      entries: $entities.filter((entity) => entity.type === 'Character').slice(0, 6)
    },
    {
      title: 'Story',
      entries: $entities
        .filter((entity) => entity.type === 'Act' || entity.type === 'Scene' || entity.type === 'Event')
        .slice(0, 6)
    },
    {
      title: 'World and notes',
      entries: $entities
        .filter((entity) => entity.type === 'Location' || entity.type === 'Artifact' || entity.type === 'Item' || entity.type === 'Note')
        .slice(0, 6)
    }
  ]);
</script>

<div class="desktop">
  {#if !hasVisibleWindows}
    <main class="story-index" aria-label="Story workspace overview">
      {#if $entities.length > 0}
        <header class="index-heading">
          <h1>The story so far</h1>
          <p>{$entities.length} {$entities.length === 1 ? 'entry' : 'entries'} across your cast, structure, and world.</p>
        </header>

        <div class="index-grid">
          {#each sections as section}
            <section>
              <h2>{section.title}</h2>
              {#if section.entries.length > 0}
                <ul>
                  {#each section.entries as entity}
                    <li>
                      <button onclick={() => windowStore.openForEntity(entity.id, entity.type)}>
                        <span class="entry-name">{entity.name}</span>
                        <span class="entry-type">{entity.type}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="section-empty">Nothing here yet.</p>
              {/if}
            </section>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <h1>Start with one true thing.</h1>
          <p>Give the story a person, a place, or a piece of the world. The shape can come later.</p>
          <div class="empty-actions">
            <button class="primary-action" onclick={() => windowStore.open('character-editor')}>Create a character</button>
            <button class="secondary-action" onclick={() => windowStore.open('wiki')}>Open the wiki</button>
          </div>
        </div>
      {/if}
    </main>
  {/if}
</div>

<style>
  .desktop {
    position: fixed;
    inset: 0;
    bottom: var(--taskbar-height);
    overflow: auto;
    background: var(--color-desktop);
    pointer-events: none;
  }

  .story-index {
    width: min(960px, calc(100% - 64px));
    margin: 0 auto;
    padding: clamp(56px, 10vh, 104px) 0 56px;
    pointer-events: auto;
  }

  .index-heading,
  .empty-state {
    max-width: 620px;
  }

  h1 {
    font-family: var(--font-display);
    font-size: clamp(30px, 4vw, 42px);
    font-weight: 600;
    line-height: 1.08;
    color: var(--color-text);
  }

  .index-heading p,
  .empty-state > p {
    margin-top: 12px;
    color: var(--color-text-muted);
    font-size: 15px;
    line-height: 1.6;
  }

  .index-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 40px;
    margin-top: 52px;
  }

  section h2 {
    margin-bottom: 12px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
  }

  ul {
    list-style: none;
    border-top: 1px solid var(--color-border);
  }

  li {
    border-bottom: 1px solid var(--color-border);
  }

  li button {
    width: 100%;
    min-height: 44px;
    padding: 10px 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    text-align: left;
  }

  li button:hover .entry-name {
    color: var(--color-accent);
  }

  .entry-name {
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-type,
  .section-empty {
    color: var(--color-text-muted);
    font-size: 11px;
  }

  .section-empty {
    padding-top: 12px;
    border-top: 1px solid var(--color-border);
  }

  .empty-actions {
    display: flex;
    gap: 10px;
    margin-top: 24px;
  }

  .empty-actions button {
    min-height: 40px;
    padding: 0 16px;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 600;
  }

  .primary-action {
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-on-accent);
  }

  .secondary-action {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
  }

  .secondary-action:hover {
    background: var(--color-surface);
  }

  @media (max-width: 760px) {
    .story-index {
      width: min(100% - 32px, 560px);
      padding-top: 40px;
    }

    .index-grid {
      grid-template-columns: 1fr;
      gap: 28px;
      margin-top: 36px;
    }
  }
</style>
