# 0014: Story-owned whiteboard documents

Status: accepted

## Decision

Each story owns multiple named whiteboards in a separate `whiteboards` table. A board stores a versioned JSON document with ordered elements and a viewport. Sticky notes, text, rectangles, ellipses, arrows, pen strokes, images, references, and frames share bounded geometry. A frame's members keep absolute coordinates and a `frameId`; moving the frame moves its direct members. Removing a frame leaves its contents on the board.

References store a target kind and ID. Entity cards display the current entity name/type and open its existing editor. Map cards open the exact map. Graph cards open a focused graph for the referenced entity. Newly added references must belong to the story. Deleted targets leave unavailable cards so deleting story content does not discard board layout.

The client autosaves a complete document after 500 ms of inactivity. Each update compares a revision and increments it atomically. A stale save returns 409 instead of overwriting another tab. Failed drafts remain in memory, with retry, JSON download, and explicit discard controls. Story switching and sign-out flush drafts; unsaved changes warn before a tab leaves. Undo retains 20 whole-document snapshots in the current session.

## Bounds and storage

A story supports 100 boards. A board supports 1,000 elements, 50,000 total stroke points, and a 2 MiB document. Geometry and text have explicit bounds. These limits keep full-document saves practical; operation logs are unnecessary for this first version.

Images reuse the map upload validator, R2 binding, and file endpoint, with a fresh UUID prefix per upload. Existing backup image-reference scanning includes whiteboard JSON, and the existing orphan grace period handles abandoned uploads. Account exports include whiteboards. Exported JSON contains image URLs, not image bytes.

Migration 0030 is additive and must run before deploying the new Worker. The previous Worker ignores the new table, so rolling back the application preserves boards. Boards are independent of entities and graph layout, and deleting a story cascades to its boards.
