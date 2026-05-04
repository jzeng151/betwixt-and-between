// Loader: takes a SeedStory, talks to the running app's API, and creates
// every row. Idempotent — finds and deletes any prior rows tagged with
// the same `data._seed` key before creating fresh ones.
//
// The CLI in `cli.ts` is one consumer; T7 (Bulk paste / import UI) will
// be another. Both call `loadStory(...)`.
import type {
  SeedStory,
  SeedAct,
  SeedLocation,
  SeedCharacter,
  SeedEvent,
  SeedScene,
  SeedRelationship,
  SeedInterval,
  SeedAlias
} from './types.js';

export interface LoadOptions {
  /** Base URL of the running app, e.g. http://localhost:5173 */
  baseUrl: string;
  /** Print a progress line per phase. Defaults to true. */
  verbose?: boolean;
}

export interface LoadCounts {
  deleted: number;
  acts: number;
  locations: number;
  characters: number;
  events: number;
  scenes: number;
  relationships: number;
  intervals: number;
  aliases: number;
}

interface EntityRow {
  id: string;
  type: string;
  name: string;
  data: Record<string, unknown> | null;
  parentId: string | null;
  position: number | null;
}

interface SeedTag {
  _seed: string;
}

function tag(seedKey: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { _seed: seedKey, ...extra };
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status} ${res.statusText}\n${body}`);
  }
  // 204 No Content has no body to parse.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function loadStory(story: SeedStory, opts: LoadOptions): Promise<LoadCounts> {
  const { baseUrl } = opts;
  const verbose = opts.verbose ?? true;
  const log = (msg: string) => verbose && console.log(`  ${msg}`);
  const seedKey = story.metadata.seedKey;

  // Names must be unique across ALL entity types within a single seed
  // file because relationships/intervals reference entities by name.
  // `resolveEntityId` walks the type maps in priority order, so a
  // cross-type collision would silently bind to the first match. Catch
  // it here with a clear error instead of producing wrong-but-valid
  // foreign-key wiring.
  {
    const seen = new Map<string, string>(); // name → "Type"
    const declare = (name: string, kind: string) => {
      const prior = seen.get(name);
      if (prior && prior !== kind) {
        throw new Error(
          `Seed name collision: '${name}' is declared as both ${prior} and ${kind}. ` +
            `Names must be unique across all entity types within a seed file.`
        );
      }
      if (prior) {
        throw new Error(
          `Seed name collision: '${name}' is declared twice as ${kind}.`
        );
      }
      seen.set(name, kind);
    };
    for (const a of story.acts) declare(a.name, 'Act');
    for (const l of story.locations) declare(l.name, 'Location');
    for (const c of story.characters) declare(c.name, 'Character');
    for (const e of story.events) declare(e.name, 'Event');
    for (const s of story.scenes ?? []) declare(s.name, 'Scene');
  }

  // ── Phase 1: clean prior seed rows ─────────────────────────────────
  log(`scanning for prior _seed='${seedKey}' rows…`);
  const allEntities = await jfetch<EntityRow[]>(`${baseUrl}/api/entities`);
  const stale = allEntities.filter((e) => {
    const d = (e.data ?? {}) as Partial<SeedTag>;
    return d._seed === seedKey;
  });
  log(`deleting ${stale.length} stale rows (cascades to relationships, intervals)…`);
  // DELETE serially. parent_id between Acts and child Scenes has
  // ON DELETE CASCADE, so deleting an Act first cascade-removes its
  // Scenes; the loop's subsequent DELETE on those Scenes returns 404.
  // We treat 404 as success — the row is already gone, which is what
  // the loop is trying to achieve. Anything else still aborts.
  for (const e of stale) {
    try {
      await jfetch(`${baseUrl}/api/entities/${e.id}`, { method: 'DELETE' });
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.includes('404')) throw err;
    }
  }
  const deleted = stale.length;

  // ── Phase 2: create entities in dependency order ───────────────────
  // Acts first (no FK deps). Then non-Act non-Scene types. Then Scenes
  // (need parent_id pointing at Acts). Tracking name → id per type so
  // names with the same string but different types don't collide.
  // (e.g. an Event "Death" and a Note "Death" — unlikely in practice
  // but cheap to be safe.)
  const idByActName = new Map<string, string>();
  const idByLocationName = new Map<string, string>();
  const idByCharacterName = new Map<string, string>();
  const idByEventName = new Map<string, string>();
  const idBySceneName = new Map<string, string>();

  log(`creating ${story.acts.length} acts…`);
  for (const a of story.acts) {
    const created = await jfetch<EntityRow>(`${baseUrl}/api/entities`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'Act',
        name: a.name,
        position: a.position,
        data: tag(seedKey, { summary: a.summary ?? '' })
      })
    });
    idByActName.set(a.name, created.id);
  }

  log(`creating ${story.locations.length} locations…`);
  for (const l of story.locations) {
    const created = await jfetch<EntityRow>(`${baseUrl}/api/entities`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'Location',
        name: l.name,
        data: tag(seedKey, { summary: l.summary ?? '' })
      })
    });
    idByLocationName.set(l.name, created.id);
  }

  log(`creating ${story.characters.length} characters…`);
  for (const c of story.characters) {
    const charData: Record<string, unknown> = {
      role: c.role ?? '',
      affiliation: c.affiliation ?? '',
      motivation: c.motivation ?? '',
      notes: c.notes ?? '',
      timelineLabel: c.timelineLabel ?? { mode: 'name-and-note' }
    };
    if (c.color) charData.color = c.color;
    const created = await jfetch<EntityRow>(`${baseUrl}/api/entities`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'Character',
        name: c.name,
        data: tag(seedKey, charData)
      })
    });
    idByCharacterName.set(c.name, created.id);
  }

  log(`creating ${story.events.length} events…`);
  for (const e of story.events) {
    const created = await jfetch<EntityRow>(`${baseUrl}/api/entities`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'Event',
        name: e.name,
        data: tag(seedKey, { summary: e.summary ?? '' })
      })
    });
    idByEventName.set(e.name, created.id);
  }

  const scenes = story.scenes ?? [];
  if (scenes.length > 0) {
    log(`creating ${scenes.length} scenes…`);
    for (const s of scenes) {
      const parentActId = idByActName.get(s.parentAct);
      if (!parentActId) {
        throw new Error(
          `Scene '${s.name}' references unknown parent Act '${s.parentAct}'`
        );
      }
      const created = await jfetch<EntityRow>(`${baseUrl}/api/entities`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'Scene',
          name: s.name,
          parentId: parentActId,
          data: tag(seedKey, { summary: s.summary ?? '' })
        })
      });
      idBySceneName.set(s.name, created.id);
    }
  }

  // ── Phase 3: relationships ─────────────────────────────────────────
  // Resolve names → ids by looking across ALL entity-name maps. This
  // lets a relationship reference any entity by name without the seed
  // file having to declare which type the endpoints are.
  function resolveEntityId(name: string): string {
    return (
      idByCharacterName.get(name) ??
      idByLocationName.get(name) ??
      idByEventName.get(name) ??
      idBySceneName.get(name) ??
      idByActName.get(name) ??
      ''
    );
  }

  // Relationship and interval rows are NOT tagged with `_seed` because
  // those tables have no `data` column (schema.ts: relationships has
  // fromId/toId/label/type only; intervals has entity_id/act_ids/
  // positions only). Cleanup relies on the cascade behavior already
  // declared in the schema: every FK from these tables to `entities`
  // is `onDelete: cascade`, so deleting any seeded entity removes its
  // relationships and intervals automatically. This is the correct
  // cleanup strategy for these tables — adding tagging would require
  // a migration and gain nothing.
  log(`creating ${story.relationships.length} relationships…`);
  for (const r of story.relationships) {
    const fromId = resolveEntityId(r.from);
    const toId = resolveEntityId(r.to);
    if (!fromId) throw new Error(`Relationship .from='${r.from}' did not resolve to any seeded entity`);
    if (!toId) throw new Error(`Relationship .to='${r.to}' did not resolve to any seeded entity`);
    await jfetch(`${baseUrl}/api/relationships`, {
      method: 'POST',
      body: JSON.stringify({
        fromId,
        toId,
        type: r.type,
        label: r.label ?? null
      })
    });
  }

  // ── Phase 4: intervals ─────────────────────────────────────────────
  log(`creating ${story.intervals.length} intervals…`);
  for (const iv of story.intervals) {
    const entityId = resolveEntityId(iv.character);
    if (!entityId) throw new Error(`Interval .character='${iv.character}' did not resolve to any seeded entity`);
    const startActId = idByActName.get(iv.fromAct);
    if (!startActId) throw new Error(`Interval .fromAct='${iv.fromAct}' is not a seeded act`);
    const endActId = idByActName.get(iv.toAct);
    if (!endActId) throw new Error(`Interval .toAct='${iv.toAct}' is not a seeded act`);
    const startSceneId = iv.fromScene ? idBySceneName.get(iv.fromScene) : undefined;
    if (iv.fromScene && !startSceneId) {
      throw new Error(`Interval .fromScene='${iv.fromScene}' is not a seeded scene`);
    }
    const endSceneId = iv.toScene ? idBySceneName.get(iv.toScene) : undefined;
    if (iv.toScene && !endSceneId) {
      throw new Error(`Interval .toScene='${iv.toScene}' is not a seeded scene`);
    }
    await jfetch(`${baseUrl}/api/intervals`, {
      method: 'POST',
      body: JSON.stringify({
        entity_id: entityId,
        start_act_id: startActId,
        start_scene_id: startSceneId ?? null,
        end_act_id: endActId,
        end_scene_id: endSceneId ?? null
      })
    });
  }

  // ── Phase 5: aliases ──────────────────────────────────────────────────
  const aliases = story.aliases ?? [];
  // Build 0-based index map for acts (sorted by position, matching the story-time axis).
  const sortedActNames = [...story.acts].sort((a, b) => a.position - b.position).map((a) => a.name);
  const indexByActName = new Map(sortedActNames.map((name, i) => [name, i]));

  log(`creating ${aliases.length} aliases…`);
  for (const al of aliases) {
    const primaryEntityId = resolveEntityId(al.primary);
    if (!primaryEntityId) throw new Error(`Alias .primary='${al.primary}' did not resolve to any seeded entity`);
    const aliasEntityId = resolveEntityId(al.alias);
    if (!aliasEntityId) throw new Error(`Alias .alias='${al.alias}' did not resolve to any seeded entity`);

    let revealedAtPosition: number | null = null;
    if (al.revealedAtAct !== undefined) {
      const idx = indexByActName.get(al.revealedAtAct);
      if (idx === undefined) throw new Error(`Alias .revealedAtAct='${al.revealedAtAct}' is not a seeded act`);
      revealedAtPosition = idx;
    }

    await jfetch(`${baseUrl}/api/entity-aliases`, {
      method: 'POST',
      body: JSON.stringify({ primaryEntityId, aliasEntityId, revealedAtPosition })
    });
  }

  return {
    deleted,
    acts: story.acts.length,
    locations: story.locations.length,
    characters: story.characters.length,
    events: story.events.length,
    scenes: scenes.length,
    relationships: story.relationships.length,
    intervals: story.intervals.length,
    aliases: aliases.length
  };
}
