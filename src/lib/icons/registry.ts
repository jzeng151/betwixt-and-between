// Generic-icon registry for entity placeholders.
//
// Stored on entities as `data.icon = "lucide:sword"` (a stable string ID,
// NOT the Svelte component). The registry maps ID → component + display
// metadata. Storing the ID instead of the component lets us swap icon
// libraries later without a data migration: only this file changes.
//
// Phase 1 ships character archetypes only; locations / events / scenes
// are tracked at the bottom of TODOS.md.

// Per-icon imports — the package's main barrel
// (`lucide-svelte/dist/lucide-svelte.js`) re-exports from a path that
// doesn't exist in the v1.0.1 tarball, so importing from
// `'lucide-svelte'` blows up at module-resolution time. The
// `lucide-svelte/icons/<name>` paths are the explicit per-icon entries
// the package's `exports` field documents and they ship fine.
import Sword from 'lucide-svelte/icons/sword';
import Shield from 'lucide-svelte/icons/shield';
import Crown from 'lucide-svelte/icons/crown';
import BookOpen from 'lucide-svelte/icons/book-open';
import Skull from 'lucide-svelte/icons/skull';
import Flame from 'lucide-svelte/icons/flame';
import Bone from 'lucide-svelte/icons/bone';
import WandSparkles from 'lucide-svelte/icons/wand-sparkles';
import Moon from 'lucide-svelte/icons/moon';
import Eye from 'lucide-svelte/icons/eye';
import Compass from 'lucide-svelte/icons/compass';
import Footprints from 'lucide-svelte/icons/footprints';
import Bird from 'lucide-svelte/icons/bird';

import type { ComponentType, SvelteComponent } from 'svelte';

// Lucide v1 ships class-based Svelte components; the IconProps type is
// not stably exported, so a `ComponentType<SvelteComponent>` is the
// loosest correct type that still lets `<IconComp ... />` typecheck.
type IconComponent = ComponentType<SvelteComponent>;

export type IconCategory = 'Heroes' | 'Villains' | 'Mystics' | 'Wanderers';

export interface IconEntry {
  id: string;            // e.g. "lucide:sword"
  label: string;         // human-readable, shown as a tooltip
  category: IconCategory;
  component: IconComponent;
}

// Order within each category drives picker layout.
const CHARACTER_ICONS: IconEntry[] = [
  { id: 'lucide:sword',     label: 'Warrior',  category: 'Heroes',    component: Sword },
  { id: 'lucide:shield',    label: 'Defender', category: 'Heroes',    component: Shield },
  { id: 'lucide:crown',     label: 'Royal',    category: 'Heroes',    component: Crown },
  { id: 'lucide:book-open', label: 'Scholar',  category: 'Heroes',    component: BookOpen },

  { id: 'lucide:skull',     label: 'Tyrant',   category: 'Villains',  component: Skull },
  { id: 'lucide:flame',     label: 'Destroyer',category: 'Villains',  component: Flame },
  { id: 'lucide:bone',      label: 'Beast',    category: 'Villains',  component: Bone },

  { id: 'lucide:wand-sparkles', label: 'Mage',  category: 'Mystics', component: WandSparkles },
  { id: 'lucide:moon',          label: 'Seer',  category: 'Mystics', component: Moon },
  { id: 'lucide:eye',           label: 'Spy',   category: 'Mystics', component: Eye },

  { id: 'lucide:compass',    label: 'Explorer', category: 'Wanderers', component: Compass },
  { id: 'lucide:footprints', label: 'Traveler', category: 'Wanderers', component: Footprints },
  { id: 'lucide:bird',       label: 'Messenger',category: 'Wanderers', component: Bird },
];

const BY_ID = new Map<string, IconEntry>(CHARACTER_ICONS.map((e) => [e.id, e]));

export function getCharacterIcon(id: string | undefined | null): IconEntry | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function listCharacterIcons(): IconEntry[] {
  return CHARACTER_ICONS;
}

export const CHARACTER_ICON_CATEGORIES: IconCategory[] = [
  'Heroes',
  'Villains',
  'Mystics',
  'Wanderers',
];
