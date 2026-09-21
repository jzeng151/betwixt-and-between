# Retain one automatic map checkpoint

Automatic map anchors are derived caches; authored anchors and the event log hold the story. Replace older synthetic anchors whenever a new automatic checkpoint is baked, under the existing map row lock, and return removed IDs through the existing client invalidation response. A successful bake also prompts the editor to reload its checkpoint; an authored conflict skips the bake and retains the previous cache. This removes cumulative copies of brush history without deleting strokes, undo records, authored snapshots, or baseline geometry; existing maps shrink on their next bake, without a migration.

Earlier timeline frames may replay more events. The latest checkpoint still contains the full accumulated stroke state, and authored snapshots can still duplicate art; this is not a total per-map storage cap. Prefer measuring those costs before introducing stroke quotas or changing history semantics.
