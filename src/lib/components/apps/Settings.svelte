<script lang="ts">
  import { preferences, setPreference, getPreference } from '$lib/os/preferences-store.js';
  import { applyPreferencePatch } from '$lib/os/preferences-sync.js';
  import { applyPaletteVars } from '$lib/palette-vars.js';
  import type { Editor } from '$lib/types/preferences.js';
  import {
    swatchesForGroup,
    swatchOverride,
    isModified,
    buildSetPatch,
    buildUnsetPatch,
    buildGroupResetPatch,
    type ColorGroup,
    type ColorSwatch
  } from '$lib/settings-colors.js';

  let activeSection = $state<string>('appearance');

  // Appearance is read reactively from the store; ALL appearance writes go
  // through applyPreferencePatch (optimistic local + debounced server PATCH).
  // Theme + the color palette are APPLIED globally by +layout.svelte, so this
  // panel only authors changes — it never touches documentElement itself.
  const appearance = $derived($preferences.appearance);

  // Editor prefs are local-only (not part of the color customization feature).
  let editor = $state<Editor>(getPreference('editor') as Editor);
  $effect(() => {
    setPreference('editor', { ...editor });
  });

  function setTheme(theme: 'dark' | 'light') {
    applyPreferencePatch({ set: { appearance: { theme } } });
  }
  function setAccent(hex: string) {
    applyPreferencePatch({ set: { appearance: { accentColor: hex } } });
  }
  function setSwatch(sw: ColorSwatch, hex: string) {
    applyPreferencePatch(buildSetPatch(sw, hex));
  }

  // F4 (perf): a native <input type="color"> fires `input` continuously while
  // the picker is dragged. Committing each one through applyPreferencePatch
  // churns $preferences and rebuilds the world-map sprites on every event. So
  // `input` only paints a cheap, local CSS-var preview on the DOM (the graph /
  // wiki update live for free; the map stays still), and the actual patch is
  // committed once on `change` (release). On commit, +layout's applyPaletteVars
  // re-asserts the managed var from the store, superseding this preview.
  function previewVar(cssVarToken: string, hex: string) {
    if (typeof document === 'undefined') return;
    const name = cssVarToken.replace(/^var\((--[a-z0-9-]+)\)$/, '$1');
    document.documentElement.style.setProperty(name, hex);
  }
  // On blur, drop any uncommitted preview by reconciling EVERY managed var back
  // to the store (applyPaletteVars sets overridden vars + REMOVES non-overridden
  // ones). Reverting from the store, not the live CSS var, is the fix for codex
  // P2: `inputValue(sw)`→`defaultHex()` reads getComputedStyle, which `previewVar`
  // already polluted, so an abandoned preview on an unmodified swatch would never
  // revert. The store is the source of truth and is unaffected by the preview.
  function revertPreview() {
    applyPaletteVars(appearance);
  }
  function resetSwatch(sw: ColorSwatch) {
    applyPreferencePatch(buildUnsetPatch(sw));
  }
  function resetGroup(group: ColorGroup) {
    const patch = buildGroupResetPatch(appearance, group);
    if (patch.unset.length) applyPreferencePatch(patch);
  }

  // Concrete hex for the native color input when a swatch isn't overridden:
  // read the computed --color-* token. Client-only (Settings is a window app).
  function defaultHex(cssVar: string): string {
    if (typeof document === 'undefined') return '#000000';
    const name = cssVar.replace(/^var\((--[a-z0-9-]+)\)$/, '$1');
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000';
  }
  function inputValue(sw: ColorSwatch): string {
    return swatchOverride(appearance, sw) ?? defaultHex(sw.cssVar);
  }

  const COLOR_GROUPS: { group: ColorGroup; label: string }[] = [
    { group: 'entity', label: 'Entity Colors' },
    { group: 'relationship', label: 'Relationship Colors' },
    { group: 'role', label: 'Role Colors' }
  ];

  const groupHasOverrides = (group: ColorGroup) =>
    swatchesForGroup(group).some((s) => isModified(appearance, s));
</script>

<div class="settings">
  <nav class="sidebar">
    <button
      class="sidebar-item"
      class:active={activeSection === 'appearance'}
      onclick={() => (activeSection = 'appearance')}
    >
      Appearance
    </button>
    <button
      class="sidebar-item"
      class:active={activeSection === 'editor'}
      onclick={() => (activeSection = 'editor')}
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
              checked={appearance.theme === 'dark'}
              onchange={() => setTheme('dark')}
            />
            Dark
          </label>
          <label class="radio-option">
            <input
              type="radio"
              name="theme"
              checked={appearance.theme === 'light'}
              onchange={() => setTheme('light')}
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
          oninput={(e) => previewVar('--color-accent', (e.target as HTMLInputElement).value)}
          onchange={(e) => setAccent((e.target as HTMLInputElement).value)}
          onblur={revertPreview}
        />
      </div>

      {#each COLOR_GROUPS as g (g.group)}
        <div class="setting-group">
          <span class="setting-label">{g.label}</span>
          <div class="swatch-list">
            {#each swatchesForGroup(g.group) as sw (sw.key)}
              <div class="swatch-row">
                <!-- The chip IS the live sample: it renders in the chosen color
                     and opens the native picker on click. Name is always shown
                     so color isn't the only signal (colorblind-safe). -->
                <label class="swatch" style="--chip: {swatchOverride(appearance, sw) ?? sw.cssVar}">
                  <span class="swatch-fill"></span>
                  <span class="swatch-name">{sw.label}</span>
                  {#if isModified(appearance, sw)}
                    <span class="swatch-modified" title="Customized"></span>
                  {/if}
                  <input
                    type="color"
                    class="swatch-input"
                    value={inputValue(sw)}
                    oninput={(e) => previewVar(sw.cssVar, (e.target as HTMLInputElement).value)}
                    onchange={(e) => setSwatch(sw, (e.target as HTMLInputElement).value)}
                    onblur={revertPreview}
                  />
                </label>
                {#if isModified(appearance, sw)}
                  <button
                    class="swatch-reset"
                    title="Reset to default"
                    aria-label="Reset {sw.label} to default"
                    onclick={() => resetSwatch(sw)}
                  >
                    ↺
                  </button>
                {/if}
              </div>
            {/each}
          </div>
          {#if groupHasOverrides(g.group)}
            <button class="group-reset" onclick={() => resetGroup(g.group)}>
              Reset {g.label.toLowerCase()} to default
            </button>
          {/if}
        </div>
      {/each}
    {:else if activeSection === 'editor'}
      <h2>Editor</h2>

      <div class="setting-group">
        <label class="checkbox-row">
          <input
            type="checkbox"
            checked={editor.linkPreviewEnabled}
            onchange={(e) => (editor = { ...editor, linkPreviewEnabled: (e.target as HTMLInputElement).checked })}
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
    font-size: 9px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
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

  /* Color swatches — EntityLink-chip aesthetic (tinted bg / chip-color border
     + text). The chip renders in the chosen color (live sample) and opens the
     native color input on click. --chip is set per row. */
  .swatch-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .swatch-row {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .swatch {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 11px;
    cursor: pointer;
    color: var(--chip);
    background: color-mix(in srgb, var(--chip) 13%, transparent);
    border: 1px solid color-mix(in srgb, var(--chip) 33%, transparent);
    transition: background 0.15s ease;
  }

  .swatch:hover {
    background: color-mix(in srgb, var(--chip) 22%, transparent);
  }

  .swatch:focus-within {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .swatch-fill {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--chip);
    flex-shrink: 0;
  }

  .swatch-name {
    color: var(--color-text);
  }

  .swatch-modified {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-accent);
    flex-shrink: 0;
  }

  /* Native input is the click target but visually replaced by the chip. */
  .swatch-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: none;
    padding: 0;
  }

  .swatch-reset {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .swatch-reset:hover {
    color: var(--color-text);
    background: var(--color-surface-2);
  }

  .group-reset {
    display: block;
    margin-top: 10px;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
    text-decoration: underline;
  }

  .group-reset:hover {
    color: var(--color-text);
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
