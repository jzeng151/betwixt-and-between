# Saved story export

The first export format is a versioned JSON snapshot of the authenticated account's saved application tables. A read-only, repeatable-read transaction keeps related rows consistent while other tabs save. Authentication tables are excluded by an explicit allowlist, and child tables without an owner column are scoped through their parent.

The envelope is `{ format: "betwixt-story", version: 1, exportedAt, tables }`. Table keys and row properties use the schema's camelCase names. IDs, timestamps, undone map events, and synthetic anchors are retained. Non-finite numeric positions use strings, including `"-Infinity"` for the baseline map anchor, because JSON numbers cannot represent them. Changes that alter these meanings require a new format version.

Profiles are appearance/layout preferences, not separate stories, so the export covers the whole account. It excludes unsaved browser drafts and does not fetch uploaded or remote image bytes. URLs and inline data URLs remain as stored. The UI names these limits and does not promise a restorable backup; importing is separate work.

The current worker materializes a download up to 16 MiB of serialized table data and 10,000 rows per table. It returns 413 without a file above either limit. A streamed archive is the upgrade path for larger stories or bundled images.
