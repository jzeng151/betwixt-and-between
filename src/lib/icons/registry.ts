// Generic-icon registry for entity placeholders.
//
// Stored on entities as `data.icon = "lucide:sword"` (a stable string ID,
// NOT the Svelte component). The registry maps ID → component + display
// metadata. Storing the ID instead of the component lets us swap icon
// libraries later without a data migration: only this file changes.
//
// Phase 1 ships character archetypes only; locations / events / scenes
// are tracked at the bottom of TODOS.md.

import {
  Sword,
  Shield,
  Crown,
  BookOpen,
  Skull,
  Flame,
  Bone,
  WandSparkles,
  Moon,
  Eye,
  Compass,
  Footprints,
  Bird,
  type Icon as LucideIcon,
} from 'lucide-svelte';

export type IconCategory = 'Heroes' | 'Villains' | 'Mystics' | 'Wanderers';

export interface IconEntry {
  id: string;            // e.g. "lucide:sword"
  label: string;         // human-readable, shown as a tooltip
  category: IconCategory;
  component: typeof LucideIcon;
}

// Order within each category drives picker layout.
const CHARACTER_ICONS: IconEntry[] = [
  // Heroes — protagonist / ally archetypes
  { id: 'lucide:sword',     label: 'Warrior',  category: 'Heroes',    component: Sword },
  { id: 'lucide:shield',    label: 'Defender', category: 'Heroes',    component: Shield },
  { id: 'lucide:crown',     label: 'Royal',    category: 'Heroes',    component: Crown },
  { id: 'lucide:book-open', label: 'Scholar',  category: 'Heroes',    component: BookOpen },

  // Villains — antagonist / threat archetypes
  { id: 'lucide:skull',     label: 'Tyrant',   category: 'Villains',  component: Skull },
  { id: 'lucide:flame',     label: 'Destroyer',category: 'Villains',  component: Flame },
  { id: 'lucide:bone',      label: 'Beast',    category: 'Villains',  component: Bone },

  // Mystics — magic / unseen archetypes
  { id: 'lucide:wand-sparkles', label: 'Mage',  category: 'Mystics', component: WandSparkles },
  { id: 'lucide:moon',          label: 'Seer',  category: 'Mystics', component: Moon },
  { id: 'lucide:eye',           label: 'Spy',   category: 'Mystics', component: Eye },

  // Wanderers — common / supporting archetypes
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
