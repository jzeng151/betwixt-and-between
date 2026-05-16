<script lang="ts">
  import { preferences, setPreference, getPreference } from '$lib/stores/preferences.js';
  import type { Appearance, Editor } from '$lib/types/preferences.js';

  let activeSection = $state<string>('appearance');

  let appearance = $state<Appearance>(getPreference('appearance') as Appearance);
  let editor = $state<Editor>(getPreference('editor') as Editor);

  function applyTheme(theme: 'dark' | 'light') {
    if (typeof document !== 'undefined') {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    }
  }

  function applyAccentColor(color: string) {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--color-accent', color);
    }
  }

  // Single effect: persist + apply when appearance changes
  $effect(() => {
    setPreference('appearance', { ...appearance });
    applyTheme(appearance.theme);
    applyAccentColor(appearance.accentColor);
  });

  // Editor preferences persist on change. No separate "apply" step —
  // EditableField subscribes to the store directly.
  $effect(() => {
    setPreference('editor', { ...editor });
  });

  // Apply on mount from saved prefs
  // svelte-ignore state_referenced_locally
  applyTheme(appearance.theme);
  // svelte-ignore state_referenced_locally
  applyAccentColor(appearance.accentColor);
</script>

<div class="settings">
  <nav class="sidebar">
    <button
      class="sidebar-item"
      class:active={activeSection === 'appearance'}
      onclick={() => activeSection = 'appearance'}
    >
      Appearance
    </button>
    <button
      class="sidebar-item"
      class:active={activeSection === 'editor'}
      onclick={() => activeSection = 'editor'}
    >
      Editor
    </button>
  </nav>
  <div class="panel">
    {#if activeSection === 'appearance'}
      <h2>Appearance</h2>

      <div class="setting-group">
        <span class="setting-label">Theme</span>
        <div class="radio-group">
          <label class="radio-option">
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={appearance.theme === 'dark'}
              onchange={() => appearance = { ...appearance, theme: 'dark' }}
            />
            Dark
          </label>
          <label class="radio-option">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={appearance.theme === 'light'}
              onchange={() => appearance = { ...appearance, theme: 'light' }}
            />
            Light
          </label>
        </div>
      </div>

      <div class="setting-group">
        <span class="setting-label">Accent Color</span>
        <input
          type="color"
          class="color-picker"
          value={appearance.accentColor}
          oninput={(e) => appearance = { ...appearance, accentColor: (e.target as HTMLInputElement).value }}
        />
      </div>
    {:else if activeSection === 'editor'}
      <h2>Editor</h2>

      <div class="setting-group">
        <label class="checkbox-row">
          <input
            type="checkbox"
            checked={editor.linkPreviewEnabled}
            onchange={(e) => editor = { ...editor, linkPreviewEnabled: (e.target as HTMLInputElement).checked }}
          />
          <span class="checkbox-label">Show link preview while editing</span>
        </label>
        <p class="setting-helper">
          Live preview of [[entity]] mentions appears below the textarea as you type.
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .settings {
    display: flex;
    height: 100%;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 13px;
  }

  .sidebar {
    width: 140px;
    border-right: 1px solid var(--color-border);
    padding: 12px 0;
    flex-shrink: 0;
  }

  .sidebar-item {
    display: block;
    width: 100%;
    padding: 8px 16px;
    background: none;
    border: none;
    color: var(--color-text-muted);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }

  .sidebar-item:hover {
    background: var(--color-surface-2);
    color: var(--color-text);
  }

  .sidebar-item.active {
    background: var(--color-surface-2);
    color: var(--color-accent);
    font-weight: 500;
  }

  .panel {
    flex: 1;
    padding: 20px 24px;
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 20px 0;
    font-size: 15px;
    font-weight: 600;
  }

  .setting-group {
    margin-bottom: 20px;
  }

  .setting-label {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .radio-group {
    display: flex;
    gap: 16px;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--color-text);
  }

  .color-picker {
    width: 36px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--color-text);
  }

  .checkbox-row input[type='checkbox'] {
    accent-color: var(--color-accent);
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .checkbox-label {
    font-size: 13px;
  }

  .setting-helper {
    margin: 6px 0 0 22px;
    font-size: 11px;
    color: var(--color-text-muted);
    font-style: italic;
    line-height: 1.4;
  }
</style>
