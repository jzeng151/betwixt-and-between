#!/usr/bin/env tsx
// Seed CLI — populates the running dev DB with a known story dataset.
//
// Usage:
//   npm run seed -- prestige
//   npm run seed -- prestige --base http://localhost:5173
//
// Pre-flight: the dev server must be running. Idempotent — re-running
// clears the prior batch (everything tagged with `data._seed === <key>`)
// before creating fresh rows.
import { loadStory } from './load.js';
import type { SeedStory } from './types.js';

const REGISTRY: Record<string, () => Promise<SeedStory>> = {
  prestige: async () => (await import('./prestige.js')).PRESTIGE
};

function parseArgs(argv: string[]): { seedKey: string; baseUrl: string } {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const seedKey = positional[0];
  if (!seedKey) {
    console.error('Usage: npm run seed -- <seed-key> [--base <url>]');
    console.error(`Available seeds: ${Object.keys(REGISTRY).join(', ')}`);
    process.exit(1);
  }
  const baseFlagIdx = args.indexOf('--base');
  const baseUrl =
    baseFlagIdx >= 0 && args[baseFlagIdx + 1]
      ? args[baseFlagIdx + 1]
      : process.env.SEED_BASE_URL ?? 'http://localhost:5173';
  return { seedKey, baseUrl };
}

async function main() {
  const { seedKey, baseUrl } = parseArgs(process.argv);

  const importer = REGISTRY[seedKey];
  if (!importer) {
    console.error(`Unknown seed key: '${seedKey}'`);
    console.error(`Available seeds: ${Object.keys(REGISTRY).join(', ')}`);
    process.exit(1);
  }

  console.log(`▸ Seeding '${seedKey}' against ${baseUrl}`);
  // Quick reachability check so the user gets a clear error instead of
  // a 50-step ECONNREFUSED stack trace from inside the loader.
  try {
    const res = await fetch(`${baseUrl}/api/entities`);
    if (!res.ok) {
      throw new Error(`GET /api/entities → ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`✗ Cannot reach the dev server at ${baseUrl}`);
    console.error(`  ${(err as Error).message}`);
    console.error(`  Run \`npm run dev\` in another terminal first.`);
    process.exit(2);
  }

  const story = await importer();
  console.log(`▸ Loaded "${story.metadata.title}" by ${story.metadata.author}`);

  const t0 = Date.now();
  let counts;
  try {
    counts = await loadStory(story, { baseUrl, verbose: true });
  } catch (err) {
    console.error(`\n✗ Seed failed: ${(err as Error).message}`);
    process.exit(3);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✓ Seed complete in ${elapsed}s`);
  console.log(`  Cleaned ${counts.deleted} prior rows`);
  console.log(`  Created:`);
  console.log(`    ${counts.acts} acts`);
  console.log(`    ${counts.locations} locations`);
  console.log(`    ${counts.characters} characters`);
  console.log(`    ${counts.events} events`);
  console.log(`    ${counts.scenes} scenes`);
  console.log(`    ${counts.relationships} relationships`);
  console.log(`    ${counts.intervals} intervals`);
  const total =
    counts.acts +
    counts.locations +
    counts.characters +
    counts.events +
    counts.scenes +
    counts.relationships +
    counts.intervals;
  console.log(`  ${total} rows total\n`);
  console.log(`  Open ${baseUrl} to see the result.`);
}

main();
