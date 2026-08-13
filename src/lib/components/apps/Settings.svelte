<script lang="ts">
  import { onMount } from 'svelte';
  import { preferences, setPreference, getPreference } from '$lib/os/preferences-store.js';
  import {
    applyPreferencePatch,
    switchProfile,
    createProfile,
    preferencesProfileId,
    preferencesOwnershipResolved
  } from '$lib/os/preferences-sync.js';
  import {
    fetchProfiles,
    renameProfileRequest,
    deleteProfileRequest
  } from '$lib/os/preferences-profiles-client.js';
  import {
    fetchPresets,
    createPresetRequest,
    deletePresetRequest,
    applyPreset
  } from '$lib/os/preferences-presets-client.js';
  import { accentForeground, applyPaletteVars } from '$lib/palette-vars.js';
  import { PREFERENCES_DEFAULTS, type Editor, type ProfileSummary } from '$lib/types/preferences.js';
  import type { PresetSummary } from '$lib/appearance-presets.js';
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
    if (name === '--color-accent') {
      document.documentElement.style.setProperty('--color-on-accent', accentForeground(hex));
    }
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

  // ── Phase 3: workspace profiles (D1) ──────────────────────────────────────
  let profiles = $state<ProfileSummary[]>([]);
  let profilesError = $state<string | null>(null);
  let busy = $state(false); // true during switch/create (disables the panel)
  let newProfileName = $state('');
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let confirmDeleteId = $state<string | null>(null);

  const activeProfileName = $derived(
    profiles.find((p) => p.isActive)?.name ?? 'Default'
  );

  async function loadProfiles() {
    try {
      profiles = await fetchProfiles();
      profilesError = null;
    } catch (e) {
      profilesError = e instanceof Error ? e.message : 'failed to load profiles';
    }
  }

  async function activateProfile(p: ProfileSummary) {
    if (p.isActive || busy) return;
    busy = true;
    try {
      await switchProfile(p.profileId);
      await loadProfiles();
      profilesError = null;
    } catch (e) {
      profilesError = e instanceof Error ? e.message : 'failed to switch profile';
    } finally {
      busy = false;
    }
  }

  async function createProfileFromInput() {
    const name = newProfileName.trim();
    if (!name || busy) return;
    busy = true;
    try {
      await createProfile(name);
      newProfileName = '';
      await loadProfiles();
      profilesError = null;
    } catch (e) {
      profilesError = e instanceof Error ? e.message : 'failed to create profile';
    } finally {
      busy = false;
    }
  }

  function startRename(p: ProfileSummary) {
    renamingId = p.profileId;
    renameDraft = p.name;
    confirmDeleteId = null;
  }
  function cancelRename() {
    renamingId = null;
    renameDraft = '';
  }
  async function commitRename(p: ProfileSummary) {
    const name = renameDraft.trim();
    if (!name || name === p.name) {
      cancelRename();
      return;
    }
    try {
      await renameProfileRequest(p.profileId, name);
      cancelRename();
      await loadProfiles();
      profilesError = null;
    } catch (e) {
      profilesError = e instanceof Error ? e.message : 'failed to rename profile';
    }
  }

  async function doDeleteProfile(p: ProfileSummary) {
    try {
      await deleteProfileRequest(p.profileId);
      confirmDeleteId = null;
      await loadProfiles();
      profilesError = null;
    } catch (e) {
      profilesError = e instanceof Error ? e.message : 'failed to delete profile';
      confirmDeleteId = null;
    }
  }

  // The last remaining profile, or the active one, cannot be deleted.
  const canDelete = (p: ProfileSummary) => !p.isActive && profiles.length > 1;
  const deleteDisabledReason = (p: ProfileSummary) =>
    p.isActive
      ? 'Switch to another profile before deleting this one'
      : 'Cannot delete your last profile';

  // ── Phase 3: appearance presets (D2) ──────────────────────────────────────
  let builtinPresets = $state<PresetSummary[]>([]);
  let userPresets = $state<PresetSummary[]>([]);
  let presetsError = $state<string | null>(null);
  let newPresetName = $state('');
  let savingPreset = $state(false);
  // The preset awaiting an apply-confirm (Gap Z: only when the active profile
  // has customizations to lose). null = no pending confirm.
  let pendingApplyPreset = $state<PresetSummary | null>(null);

  // Does the active profile's appearance deviate from the built-in defaults?
  // Drives whether applying a preset needs a confirm (nothing to lose → silent).
  const hasAppearanceOverrides = $derived.by(() => {
    const a = appearance;
    const d = PREFERENCES_DEFAULTS.appearance;
    if (a.theme !== d.theme || a.accentColor !== d.accentColor) return true;
    for (const m of [a.entityTypeColors, a.relationshipTypeColors, a.roleColors]) {
      if (m && Object.keys(m).length > 0) return true;
    }
    return false;
  });

  async function loadPresets() {
    try {
      const { builtins, user } = await fetchPresets();
      builtinPresets = builtins;
      userPresets = user;
      presetsError = null;
    } catch (e) {
      presetsError = e instanceof Error ? e.message : 'failed to load presets';
    }
  }

  function requestApply(p: PresetSummary) {
    if (hasAppearanceOverrides) {
      pendingApplyPreset = p;
    } else {
      applyPreset(appearance, p.appearance);
    }
  }
  function confirmApply() {
    if (pendingApplyPreset) applyPreset(appearance, pendingApplyPreset.appearance);
    pendingApplyPreset = null;
  }

  async function saveCurrentAsPreset() {
    const name = newPresetName.trim();
    // Gate "Save current" until the store reflects a RESOLVED current profile:
    //   • ownership unresolved → `appearance` may be a prior user's localStorage
    //     cache on a shared browser (saves the wrong user's palette).
    //   • profileId null → post-switch limbo (a failed post-activate hydrate); the
    //     store still holds the PREVIOUS profile, so saving captures stale colors.
    // The save bypasses applyPreferencePatch (POSTs appearance directly), so it
    // needs its own guard (codex).
    if (!name || savingPreset || !$preferencesOwnershipResolved || !$preferencesProfileId) return;
    savingPreset = true;
    try {
      await createPresetRequest(name, appearance);
      newPresetName = '';
      await loadPresets();
      presetsError = null;
    } catch (e) {
      presetsError = e instanceof Error ? e.message : 'failed to save preset';
    } finally {
      savingPreset = false;
    }
  }

  async function deleteUserPreset(p: PresetSummary) {
    try {
      await deletePresetRequest(p.presetId);
      await loadPresets();
      presetsError = null;
    } catch (e) {
      presetsError = e instanceof Error ? e.message : 'failed to delete preset';
    }
  }

  onMount(() => {
    void loadProfiles();
    void loadPresets();
  });

  // Cross-tab: another tab can switch the active profile, which reaches this tab
  // via the prefs hydrate (preferencesProfileId updates) without touching our
  // cached list. Refetch when the active id changes from what the list reflects,
  // so the header + switcher don't keep showing the old profile as active while
  // the store edits the new one (codex). Skip null (transient post-activate).
  $effect(() => {
    const pid = $preferencesProfileId;
    if (!pid) return;
    const listActive = profiles.find((p) => p.isActive)?.profileId;
    if (listActive !== undefined && listActive !== pid) {
      void loadProfiles();
    }
  });
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
    <button
      class="sidebar-item"
      class:active={activeSection === 'profiles'}
      onclick={() => (activeSection = 'profiles')}
    >
      Profiles
    </button>
  </nav>
  <div class="panel">
    {#if activeSection === 'appearance'}
      <h2>Appearance</h2>
      <p class="active-profile-line">Profile: {activeProfileName}</p>

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

      <!-- Presets (D2): apply a saved appearance theme, or save the current
           colors as one. Chips/rows, not a card grid (AI-slop guard). -->
      <div class="setting-group">
        <span class="setting-label">Presets</span>
        <div class="preset-list">
          {#each [...builtinPresets, ...userPresets] as p (p.presetId)}
            <div class="preset-row">
              <button class="preset-chip" onclick={() => requestApply(p)} title="Apply {p.name}">
                <span class="preset-name">{p.name}</span>
                {#if p.builtin}<span class="preset-tag">built-in</span>{/if}
              </button>
              {#if !p.builtin}
                <button
                  class="swatch-reset"
                  title="Delete preset"
                  aria-label="Delete preset {p.name}"
                  onclick={() => deleteUserPreset(p)}
                >
                  ✕
                </button>
              {/if}
            </div>
          {/each}
        </div>
        {#if userPresets.length === 0}
          <p class="setting-helper">Save your current colors as a preset to reuse them.</p>
        {/if}

        {#if pendingApplyPreset}
          <div class="inline-confirm" role="alertdialog" aria-label="Confirm apply preset">
            <span>Apply {pendingApplyPreset.name}? This replaces this profile's current colors.</span>
            <button class="confirm-btn" onclick={confirmApply}>Apply</button>
            <button class="cancel-btn" onclick={() => (pendingApplyPreset = null)}>Cancel</button>
          </div>
        {/if}

        <div class="save-preset-row">
          <input
            class="text-input"
            type="text"
            placeholder="New preset name"
            bind:value={newPresetName}
            onkeydown={(e) => e.key === 'Enter' && saveCurrentAsPreset()}
          />
          <button
            class="action-btn"
            disabled={!newPresetName.trim() || savingPreset || !$preferencesOwnershipResolved || !$preferencesProfileId}
            onclick={saveCurrentAsPreset}
          >
            Save current
          </button>
        </div>
        {#if presetsError}
          <p class="inline-error">{presetsError}</p>
        {/if}
      </div>
    {:else if activeSection === 'editor'}
      <h2>Editor</h2>
      <p class="active-profile-line">Profile: {activeProfileName}</p>

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
    {:else if activeSection === 'profiles'}
      <h2>Profiles</h2>
      <p class="setting-helper">
        A profile is a saved workspace — its own colors, graph and window defaults.
        Switch between them anytime; only one is active.
      </p>

      <div class="setting-group">
        <div class="profile-list">
          {#each profiles as p (p.profileId)}
            <div class="profile-row" class:active={p.isActive}>
              {#if renamingId === p.profileId}
                <input
                  class="text-input rename-input"
                  type="text"
                  bind:value={renameDraft}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitRename(p);
                    else if (e.key === 'Escape') cancelRename();
                  }}
                  onblur={() => commitRename(p)}
                />
              {:else}
                <button
                  class="profile-name-btn"
                  disabled={p.isActive || busy}
                  title={p.isActive ? 'Active profile' : 'Switch to this profile'}
                  onclick={() => activateProfile(p)}
                >
                  {#if p.isActive}<span class="profile-check" aria-hidden="true">✓</span>{/if}
                  <span class="profile-name">{p.name}</span>
                  {#if p.isActive}<span class="profile-active-tag">active</span>{/if}
                </button>
                <div class="profile-actions">
                  <button class="link-btn" onclick={() => startRename(p)}>Rename</button>
                  <button
                    class="link-btn danger"
                    disabled={!canDelete(p)}
                    title={canDelete(p) ? 'Delete this profile' : deleteDisabledReason(p)}
                    onclick={() => (confirmDeleteId = p.profileId)}
                  >
                    Delete
                  </button>
                </div>
              {/if}
            </div>
            {#if confirmDeleteId === p.profileId}
              <div class="inline-confirm" role="alertdialog" aria-label="Confirm delete profile">
                <span>Delete '{p.name}'?</span>
                <button class="confirm-btn danger" onclick={() => doDeleteProfile(p)}>Delete</button>
                <button class="cancel-btn" onclick={() => (confirmDeleteId = null)}>Cancel</button>
              </div>
            {/if}
          {/each}
        </div>

        <div class="save-preset-row">
          <input
            class="text-input"
            type="text"
            placeholder="New profile name"
            bind:value={newProfileName}
            onkeydown={(e) => e.key === 'Enter' && createProfileFromInput()}
          />
          <button
            class="action-btn"
            disabled={!newProfileName.trim() || busy}
            onclick={createProfileFromInput}
          >
            New profile
          </button>
        </div>
        {#if profilesError}
          <p class="inline-error">{profilesError}</p>
        {/if}
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
    outline: 2px solid var(--color-focus);
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

  /* ── Phase 3: active-profile indicator (Gap Y mitigation) ── */
  .active-profile-line {
    margin: -12px 0 18px 0;
    font-size: 9px;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  /* ── Phase 3: presets (D2) ── */
  .preset-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .preset-row {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .preset-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    color: var(--color-text);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
  }
  .preset-chip:hover {
    border-color: var(--color-accent);
  }
  .preset-chip:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  .preset-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  /* ── Phase 3: profiles (D1) ── */
  .profile-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 14px;
  }
  .profile-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid transparent;
  }
  .profile-row.active {
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .profile-name-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    background: none;
    border: none;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .profile-name-btn:disabled {
    cursor: default;
  }
  .profile-row.active .profile-name-btn {
    color: var(--color-accent);
  }
  .profile-name-btn:not(:disabled):hover {
    background: var(--color-surface-2);
  }
  .profile-name-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  .profile-check {
    color: var(--color-accent);
    font-size: 12px;
  }
  .profile-active-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }
  .profile-actions {
    display: inline-flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    text-decoration: underline;
  }
  .link-btn:not(:disabled):hover {
    color: var(--color-text);
  }
  .link-btn.danger:not(:disabled):hover {
    color: var(--color-danger);
  }
  .link-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .link-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  /* ── Phase 3: shared inputs / confirms / errors ── */
  .text-input {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    font-size: 12px;
    padding: 5px 8px;
  }
  .text-input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }
  .rename-input {
    flex: 1;
  }
  .save-preset-row {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .action-btn {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-size: 12px;
    padding: 5px 12px;
  }
  .action-btn:not(:disabled):hover {
    border-color: var(--color-accent);
  }
  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .action-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  .inline-confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    font-size: 12px;
  }
  .confirm-btn,
  .cancel-btn {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 10px;
  }
  .confirm-btn.danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .confirm-btn:focus-visible,
  .cancel-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  .inline-error {
    margin: 8px 0 0 0;
    font-size: 11px;
    color: var(--color-danger);
  }
</style>
